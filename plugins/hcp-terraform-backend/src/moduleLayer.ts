/*
 * Single source of truth for which Vault-suite module belongs to which
 * architecture layer. Dependency-free on purpose: scripts/backfill-parent-tags.mjs
 * imports this file directly (Node strips the types), so keep it plain TS with
 * no imports.
 */

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
  return (
    MODULE_LAYER[moduleName] ?? MODULE_LAYER[`terraform-vault-${moduleName}`]
  );
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
