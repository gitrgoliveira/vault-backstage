import {
  canonicalModuleName,
  layerForModule,
  moduleNameFromSourceId,
} from './HcpTerraformWorkspaceProvider.ts';

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
    expect(layerForModule('hcptf-onboarding')).toBe('trust');
    expect(layerForModule('add-gitlab-project-access')).toBe('principal');
    expect(layerForModule('add-kvv2')).toBe('usecase');
  });

  it('also resolves the full published module name', () => {
    expect(layerForModule('terraform-vault-add-kvv2')).toBe('usecase');
    expect(layerForModule('terraform-vault-cluster-onboarding')).toBe('trust');
  });

  it('returns undefined for non-Vault no-code modules so they are skipped', () => {
    // "k8s" is a different no-code module; the Vault one is add-k8s-namespace-access.
    for (const m of ['rds', 'terramino', 'redis-ec2', 'virtual-machine', 'vpc', 'k8s']) {
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
