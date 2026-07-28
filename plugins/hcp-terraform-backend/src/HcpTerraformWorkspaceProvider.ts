import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import {
  LoggerService,
  SchedulerService,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { HcpTfClient } from './HcpTfClient';

/** Module name to architecture layer */
export const MODULE_LAYER: Record<string, string> = {
  'terraform-vault-cluster-onboarding': 'trust',
  'terraform-vault-gitlab-onboarding': 'trust',
  'terraform-vault-hcptf-onboarding': 'trust',
  'terraform-vault-add-k8s-namespace-access': 'workload',
  'terraform-vault-add-gitlab-project-access': 'workload',
  'terraform-vault-add-kvv2': 'usecase',
  'terraform-vault-add-pgsql-role': 'usecase',
  'terraform-vault-add-permission-group': 'usecase',
  'terraform-vault-pgsql-onboarding': 'usecase',
};

/**
 * Resolves the architecture layer for a module name. HCP Terraform's
 * source-module-id yields the SHORT registry name (e.g. "add-kvv2"), while the
 * MODULE_LAYER keys are the full published names ("terraform-vault-add-kvv2"),
 * so both forms are tried. Returns undefined for modules that are not part of
 * the Vault self-service suite, so unrelated no-code workspaces are skipped.
 */
export function layerForModule(moduleName: string): string | undefined {
  return MODULE_LAYER[moduleName] ?? MODULE_LAYER[`terraform-vault-${moduleName}`];
}

/**
 * Returns the full published module name (`terraform-vault-<short>`) when the
 * short registry name (as reported by HCP's source-module-id) maps to a known
 * Vault module; otherwise returns the input unchanged. Keeps
 * `hcptf.io/module-name` stable and recognizable so template `catalogFilter`s
 * can match on the full name regardless of what HCP reports.
 */
export function canonicalModuleName(moduleName: string): string {
  const full = `terraform-vault-${moduleName}`;
  return MODULE_LAYER[full] ? full : moduleName;
}

/** Derives a Backstage system name from a workspace layer. */
function layerToSystem(layer: string): string {
  const map: Record<string, string> = {
    trust: 'vault-trust',
    workload: 'vault-workload',
    usecase: 'vault-usecase',
  };
  return map[layer] ?? 'vault-self-service';
}

/** Extracts module name from source-module-id like private/org/module-name/vault/1.0.0. */
export function moduleNameFromSourceId(sourceModuleId: string | null): string | null {
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

    // Gate ingestion to workspaces that live in a Product:Vault-tagged project.
    // If the org uses no such tag (empty set), fall back to module-only
    // filtering so the catalog is not accidentally emptied.
    let vaultProjectIds: Set<string> | undefined;
    try {
      const projects = await this.client.listVaultProjects();
      if (projects.length > 0) {
        vaultProjectIds = new Set(projects.map(p => p.id));
        this.logger.info(
          `HcpTerraformWorkspaceProvider: gating ingestion to ${vaultProjectIds.size} ` +
            `Product:Vault-tagged project(s)`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `HcpTerraformWorkspaceProvider: could not list Vault-tagged projects; ` +
          `ingesting by module only: ${err.message}`,
      );
    }

    // Resolve onboarded tenant/env targets once and index them by project id so
    // each workspace can be enriched with its tenant/environment and linked to
    // the matching vault-target (used by the "create next layer" button).
    const targets = await this.discoverTargets();
    const targetByProject = new Map(targets.map(t => [t.projectId, t]));

    const entities = await Promise.all(
      workspaces
        .map(async ws => {
          const moduleName = moduleNameFromSourceId(ws.sourceModuleId);
          const layer = moduleName ? layerForModule(moduleName) : undefined;
          // Only ingest workspaces created from a Vault self-service module.
          // Other no-code modules (e.g. rds, vpc) have a source-module-id but no
          // matching layer, so they are skipped to keep the catalog Vault-only.
          if (!moduleName || !layer) return null;
          // Also require the workspace to live in a Product:Vault-tagged project
          // (when such projects exist), so stray Vault-module workspaces sitting
          // in unrelated projects are excluded.
          if (vaultProjectIds && !(ws.projectId && vaultProjectIds.has(ws.projectId))) {
            return null;
          }
          const system = layerToSystem(layer);
          const target = ws.projectId ? targetByProject.get(ws.projectId) : undefined;
          const tenant =
            target?.tenant ??
            ws.tagNames.find(t => t.startsWith(`${this.tenantTagKey}:`))?.split(':')[1] ??
            'unknown';
          // Parent workspace (previous layer) recorded at provision time as a
          // `parent:<name>` tag; drives the catalog-graph L1 -> L2 -> L3 chain.
          const parentName = ws.tagNames
            .find(t => t.startsWith('parent:'))
            ?.slice('parent:'.length);

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

          // Catalog relations that drive the relations graph:
          //  - the previous-layer workspace (L1 -> L2 -> L3 chain, from the
          //    `parent:<name>` tag recorded at provision time);
          //  - the onboarded tenant/env target this workspace belongs to, so
          //    the target's graph lists every workspace provisioned into it.
          // Both use dependsOn (the target gets the reciprocal dependencyOf).
          const dependsOn: string[] = [];
          if (parentName && parentName !== ws.name) {
            dependsOn.push(`resource:default/${parentName}`);
          }
          if (target) {
            dependsOn.push(`resource:default/${target.tenant}-${target.env}`);
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
                  'hcptf.io/module-name': canonicalModuleName(moduleName),
                  'hcptf.io/layer': layer,
                  'hcptf.io/run-status': ws.status,
                  ...(target
                    ? {
                        'hcptf.io/tenant': target.tenant,
                        'hcptf.io/environment': target.env,
                        'hcptf.io/target': `${target.tenant}-${target.env}`,
                      }
                    : {}),
                  ...outputAnnotations,
                },
                tags: [layer, moduleName.replace(/^terraform-/, ''), tenant.toLowerCase()],
              },
              spec: {
                type: 'vault-workspace',
                lifecycle: 'production',
                owner: `group:default/${tenant.toLowerCase()}`,
                system: `system:default/${system}`,
                // Link to the previous-layer workspace and the tenant/env target
                // so the catalog graph shows the L1 -> L2 -> L3 chain and each
                // target lists its workspaces (dependsOn/dependencyOf relations).
                ...(dependsOn.length > 0 ? { dependsOn } : {}),
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

    const targetEntities = this.buildTargetEntities(targets);

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
   * Discover onboarded tenant/env targets, logging and tolerating failure.
   */
  private async discoverTargets(): Promise<
    Awaited<ReturnType<HcpTfClient['discoverOnboardedTargets']>>
  > {
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
    return targets;
  }

  /**
   * Emit one Resource per onboarded tenant/environment project so templates can
   * offer a native dropdown (EntityPicker) instead of free-text tenant fields.
   */
  private buildTargetEntities(
    targets: Awaited<ReturnType<HcpTfClient['discoverOnboardedTargets']>>,
  ): { entity: any; locationKey: string }[] {
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
