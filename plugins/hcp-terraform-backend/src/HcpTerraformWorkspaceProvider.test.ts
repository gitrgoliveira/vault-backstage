import type {
  LoggerService,
  SchedulerService,
} from '@backstage/backend-plugin-api';
import type { EntityProviderConnection } from '@backstage/plugin-catalog-node';
import type { HcpTfClient, WorkspaceSummary } from './HcpTfClient';
import {
  HcpTerraformWorkspaceProvider,
  moduleNameFromSourceId,
} from './HcpTerraformWorkspaceProvider';
import { canonicalModuleName, layerForModule } from './moduleLayer';

describe('moduleNameFromSourceId', () => {
  it('extracts the short registry name from a source-module-id', () => {
    expect(
      moduleNameFromSourceId('private/hc-ric-demo/add-kvv2/vault/1.0.0'),
    ).toBe('add-kvv2');
    expect(
      moduleNameFromSourceId('private/hc-ric-demo/gitlab-onboarding/vault'),
    ).toBe('gitlab-onboarding');
  });

  it('returns null for null or malformed ids', () => {
    expect(moduleNameFromSourceId(null)).toBeNull();
    expect(moduleNameFromSourceId('private/org')).toBeNull();
  });
});

describe('layerForModule', () => {
  it('resolves the layer from the SHORT registry name (as HCP reports it)', () => {
    // Regression: HCP's source-module-id yields the short name; the MODULE_LAYER
    // keys are the long "terraform-vault-*" names. Both must resolve.
    expect(layerForModule('gitlab-onboarding')).toBe('trust');
    expect(layerForModule('hcptf-onboarding')).toBe('admin');
    expect(layerForModule('add-gitlab-project-access')).toBe('workload');
    expect(layerForModule('add-kvv2')).toBe('usecase');
  });

  it('also resolves the full published module name', () => {
    expect(layerForModule('terraform-vault-add-kvv2')).toBe('usecase');
    expect(layerForModule('terraform-vault-cluster-onboarding')).toBe('trust');
  });

  it('returns undefined for non-Vault no-code modules so they are skipped', () => {
    // "k8s" is a different no-code module; the Vault one is add-k8s-namespace-access.
    for (const m of [
      'rds',
      'terramino',
      'redis-ec2',
      'virtual-machine',
      'vpc',
      'k8s',
    ]) {
      expect(layerForModule(m)).toBeUndefined();
    }
  });
});

describe('canonicalModuleName', () => {
  it('expands a known short registry name to the full published name', () => {
    // Template catalogFilters match on the full name; the provider must emit it
    // even though HCP's source-module-id only yields the short name.
    expect(canonicalModuleName('pgsql-onboarding')).toBe(
      'terraform-vault-pgsql-onboarding',
    );
    expect(canonicalModuleName('gitlab-onboarding')).toBe(
      'terraform-vault-gitlab-onboarding',
    );
  });

  it('leaves an already-full or unknown name unchanged', () => {
    expect(canonicalModuleName('terraform-vault-add-kvv2')).toBe(
      'terraform-vault-add-kvv2',
    );
    expect(canonicalModuleName('rds')).toBe('rds');
  });
});

describe('HcpTerraformWorkspaceProvider.refresh project gate', () => {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  } as unknown as LoggerService;
  const scheduler = {
    scheduleTask: jest.fn(),
  } as unknown as SchedulerService;

  const ws = (
    name: string,
    module: string,
    projectId: string,
  ): WorkspaceSummary => ({
    id: `ws-${name}`,
    name,
    status: 'applied',
    sourceModuleId: `private/org/${module}/vault/1.0.0`,
    tagNames: [],
    projectId,
    currentStateVersionId: null,
  });

  async function emittedWorkspaces(
    workspaces: WorkspaceSummary[],
    {
      taggedProjects = [{ id: 'prj-tenant', name: 'acme-Vault-dev' }],
      adminProjectId = 'prj-admin' as string | null,
      discover = jest.fn(async () => []),
      outputs = [] as { key: string; value: unknown; sensitive: boolean }[],
    } = {},
  ) {
    const client = {
      listWorkspaces: async () => workspaces,
      listVaultProjects: async () => taggedProjects,
      findAdminProjectId: async () => adminProjectId ?? undefined,
      discoverOnboardedTargets: discover,
      readOutputsCached: async () => outputs,
      workspaceUrl: (n: string) => `https://app.terraform.io/ws/${n}`,
    } as unknown as HcpTfClient;
    const provider = new HcpTerraformWorkspaceProvider(
      client,
      'org',
      'tenant',
      logger,
      scheduler,
    );
    const applyMutation = jest.fn();
    await provider.connect({
      applyMutation,
    } as unknown as EntityProviderConnection);
    await provider.refresh();
    return applyMutation.mock.calls[0][0].entities
      .map((e: any) => e.entity)
      .filter((e: any) => e.spec.type === 'vault-workspace');
  }

  it('admits L0 workspaces from the untagged admin project as admin-layer', async () => {
    const [l0] = await emittedWorkspaces([
      ws('acme-onboarding', 'hcptf-onboarding', 'prj-admin'),
    ]);
    expect(l0.metadata.annotations['hcptf.io/layer']).toBe('admin');
    expect(l0.spec.system).toBe('system:default/vault-admin');
    expect(l0.spec.owner).toBe('group:default/vault-platform');
  });

  it('keeps tagged-project workspaces and drops strays, including non-L0 ones in the admin project', async () => {
    const names = (
      await emittedWorkspaces([
        ws('trust-ok', 'cluster-onboarding', 'prj-tenant'),
        ws('trust-stray', 'cluster-onboarding', 'prj-other'),
        ws('trust-in-admin', 'cluster-onboarding', 'prj-admin'),
      ])
    ).map((e: any) => e.metadata.name);
    expect(names).toEqual(['trust-ok']);
  });

  it('discovers tenants from the resolved admin project', async () => {
    const discover = jest.fn(async () => []);
    await emittedWorkspaces([], { discover });
    expect(discover).toHaveBeenCalledWith('prj-admin');
  });

  it('skips discovery and L0 admission when the admin project cannot be resolved', async () => {
    const discover = jest.fn(async () => []);
    const emitted = await emittedWorkspaces(
      [ws('acme-onboarding', 'hcptf-onboarding', 'prj-admin')],
      { adminProjectId: null, discover },
    );
    expect(discover).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('ingests by module only when no project carries the tag', async () => {
    const emitted = await emittedWorkspaces(
      [
        ws('acme-onboarding', 'hcptf-onboarding', 'prj-admin'),
        ws('trust-anywhere', 'cluster-onboarding', 'prj-other'),
      ],
      { taggedProjects: [] },
    );
    expect(emitted.map((e: any) => e.metadata.name)).toEqual([
      'acme-onboarding',
      'trust-anywhere',
    ]);
    expect(emitted[0].spec.owner).toBe('group:default/vault-platform');
  });

  it('renders map outputs as JSON instead of [object Object]', async () => {
    const [l0] = await emittedWorkspaces(
      [ws('acme-onboarding', 'hcptf-onboarding', 'prj-admin')],
      {
        outputs: [
          { key: 'project_ids', value: { dev: 'prj-1' }, sensitive: false },
          { key: 'admin_token', value: 'x', sensitive: true },
        ],
      },
    );
    expect(l0.metadata.annotations['hcptf.io/output.project_ids']).toBe(
      '{"dev":"prj-1"}',
    );
    expect(
      l0.metadata.annotations['hcptf.io/output.admin_token'],
    ).toBeUndefined();
  });
});
