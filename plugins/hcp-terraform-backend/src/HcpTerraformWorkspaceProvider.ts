import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import {
  LoggerService,
  SchedulerService,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { HcpTfClient } from './HcpTfClient.ts';

/** Module name to architecture layer */
const MODULE_LAYER: Record<string, string> = {
  'terraform-vault-cluster-onboarding': 'trust',
  'terraform-vault-gitlab-onboarding': 'trust',
  'terraform-vault-hcptf-onboarding': 'trust',
  'terraform-vault-add-k8s-namespace-access': 'principal',
  'terraform-vault-add-gitlab-project-access': 'principal',
  'terraform-vault-add-kvv2': 'usecase',
  'terraform-vault-add-pgsql-role': 'usecase',
  'terraform-vault-add-permission-group': 'usecase',
  'terraform-vault-pgsql-onboarding': 'usecase',
};

/** Derives a Backstage system name from a workspace layer. */
function layerToSystem(layer: string): string {
  const map: Record<string, string> = {
    trust: 'vault-trust',
    principal: 'vault-principal',
    usecase: 'vault-usecase',
  };
  return map[layer] ?? 'vault-self-service';
}

/** Extracts module name from source-module-id like private/org/module-name/vault/1.0.0. */
function moduleNameFromSourceId(sourceModuleId: string | null): string | null {
  if (!sourceModuleId) return null;
  const parts = sourceModuleId.split('/');
  // format: private/<org>/<module-name>/<provider>/<version>
  return parts.length >= 3 ? parts[2] : null;
}

/**
 * HcpTerraformWorkspaceProvider ingests HCP Terraform workspaces created by
 * Vault IDP templates as Backstage Resource entities. It populates handoff
 * output annotations so child templates can look up parent values via
 * EntityPicker + catalog:fetch.
 */
export class HcpTerraformWorkspaceProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly client: HcpTfClient,
    private readonly organization: string,
    private readonly tenantTagKey: string,
    private readonly logger: LoggerService,
    private readonly scheduler: SchedulerService,
  ) {}

  static create(opts: {
    config: Config;
    client: HcpTfClient;
    logger: LoggerService;
    scheduler: SchedulerService;
  }): HcpTerraformWorkspaceProvider {
    const cfg = opts.config.getConfig('hcpTerraform');
    return new HcpTerraformWorkspaceProvider(
      opts.client,
      cfg.getString('organization'),
      cfg.getOptionalConfig('projects')?.getOptionalString('tenantTagKey') ?? 'tenant',
      opts.logger,
      opts.scheduler,
    );
  }

  getProviderName(): string {
    return `HcpTerraformWorkspaceProvider:${this.organization}`;
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.scheduler.scheduleTask({
      id: `hcp-terraform-workspace-refresh-${this.organization}`,
      frequency: { minutes: 5 },
      timeout: { minutes: 3 },
      fn: async () => {
        await this.refresh();
      },
    });
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      this.logger.warn('HcpTerraformWorkspaceProvider: no catalog connection yet');
      return;
    }
    this.logger.info('HcpTerraformWorkspaceProvider: refreshing workspaces');

    let workspaces: Awaited<ReturnType<HcpTfClient['listWorkspaces']>>;
    try {
      workspaces = await this.client.listWorkspaces();
    } catch (err: any) {
      this.logger.error(
        `HcpTerraformWorkspaceProvider: failed to list workspaces: ${err.message}`,
      );
      return;
    }

    const entities = await Promise.all(
      workspaces
        .filter(ws => ws.sourceModuleId !== null)
        .map(async ws => {
          const moduleName = moduleNameFromSourceId(ws.sourceModuleId);
          if (!moduleName) return null;
          const layer = MODULE_LAYER[moduleName] ?? 'unknown';
          const system = layerToSystem(layer);
          const tenant =
            ws.tagNames.find(t => t.startsWith(`${this.tenantTagKey}:`))?.split(':')[1] ??
            'unknown';

          // Fetch outputs and add as annotations (non-sensitive only).
          // Cached by state-version id; no API call for unchanged/never-applied ws.
          const outputAnnotations: Record<string, string> = {};
          try {
            const outputs = await this.client.readOutputsCached(
              ws.id,
              ws.currentStateVersionId,
            );
            for (const o of outputs) {
              if (!o.sensitive) {
                outputAnnotations[`hcptf.io/output.${o.key}`] = String(o.value ?? '');
              }
            }
          } catch {
            // Outputs may not be available if workspace never applied
          }

          return {
            entity: {
              apiVersion: 'backstage.io/v1alpha1',
              kind: 'Resource',
              metadata: {
                name: ws.name,
                namespace: 'default',
                description: `HCP Terraform workspace managed by Vault IDP`,
                annotations: {
                  'backstage.io/managed-by-location': `hcp-terraform:${this.organization}`,
                  'backstage.io/managed-by-origin-location': `hcp-terraform:${this.organization}`,
                  'hcptf.io/workspace-id': ws.id,
                  'hcptf.io/workspace-url': this.client.workspaceUrl(ws.name),
                  'hcptf.io/module-name': moduleName,
                  'hcptf.io/layer': layer,
                  'hcptf.io/run-status': ws.status,
                  ...outputAnnotations,
                },
                tags: [layer, moduleName.replace(/^terraform-/, ''), tenant],
              },
              spec: {
                type: 'vault-workspace',
                lifecycle: 'production',
                owner: `group:default/${tenant}`,
                system: `system:default/${system}`,
              },
            },
            locationKey: `hcp-terraform:${ws.id}`,
          };
        }),
    );

    const validEntities = entities.filter(Boolean) as {
      entity: any;
      locationKey: string;
    }[];

    const targetEntities = await this.buildTargetEntities();

    this.logger.info(
      `HcpTerraformWorkspaceProvider: emitting ${validEntities.length} workspace + ` +
        `${targetEntities.length} tenant-target entities`,
    );

    await this.connection.applyMutation({
      type: 'full',
      entities: [...validEntities, ...targetEntities],
    });
  }

  /**
   * Emit one Resource per onboarded tenant/environment project so templates can
   * offer a native dropdown (EntityPicker) instead of free-text tenant fields.
   */
  private async buildTargetEntities(): Promise<{ entity: any; locationKey: string }[]> {
    let targets: Awaited<ReturnType<HcpTfClient['discoverOnboardedTargets']>>;
    try {
      targets = await this.client.discoverOnboardedTargets();
    } catch (err: any) {
      this.logger.warn(
        `HcpTerraformWorkspaceProvider: failed to discover onboarded targets: ${err.message}`,
      );
      return [];
    }
    if (targets.length === 0) {
      this.logger.info(
        'HcpTerraformWorkspaceProvider: no onboarded tenants discovered yet ' +
          '(no applied terraform-vault-hcptf-onboarding workspaces with project_ids output ' +
          'in the admin project).',
      );
    } else {
      this.logger.info(
        `HcpTerraformWorkspaceProvider: discovered ${targets.length} tenant target(s): ` +
          `${targets.map(t => `${t.tenant}/${t.env}`).join(', ')}`,
      );
    }
    return targets.map(t => ({
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: {
          name: `${t.tenant}-${t.env}`,
          namespace: 'default',
          title: `${t.tenant} / ${t.env}`,
          description: `Onboarded Vault tenant project "${t.name}" (${t.tenant}, ${t.env}).`,
          annotations: {
            'backstage.io/managed-by-location': `hcp-terraform:${this.organization}`,
            'backstage.io/managed-by-origin-location': `hcp-terraform:${this.organization}`,
            'hcptf.io/tenant': t.tenant,
            'hcptf.io/environment': t.env,
            'hcptf.io/project-id': t.projectId,
            'hcptf.io/project-name': t.name,
          },
          tags: ['vault-target', t.tenant.toLowerCase(), t.env.toLowerCase()],
        },
        spec: {
          type: 'vault-target',
          lifecycle: 'production',
          owner: 'group:default/vault-platform',
        },
      },
      locationKey: `hcp-terraform:target:${t.projectId}`,
    }));
  }
}
