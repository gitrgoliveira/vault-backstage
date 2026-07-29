# Publish Terraform modules

The scaffolder templates provision infrastructure through nine no-code Terraform modules. These modules must be published to your HCP Terraform private registry before the templates can use them.

## Module inventory

The source directories below are relative to the reference workspace root described in [Get the source](index.md#get-the-source).

| Module | Layer | Source directory |
|--------|-------|-----------------|
| `terraform-vault-hcptf-onboarding` | L0 (Admin) | Distributed with the private admin bootstrap |
| `terraform-vault-cluster-onboarding` | L1 (Trust) | `terraform-vault-onboarding/terraform-vault-cluster-onboarding/` |
| `terraform-vault-gitlab-onboarding` | L1 (Trust) | `terraform-vault-onboarding/terraform-vault-gitlab-onboarding/` |
| `terraform-vault-add-k8s-namespace-access` | L2 (Workload) | `terraform-vault-onboarding/terraform-vault-add-k8s-namespace-access/` |
| `terraform-vault-add-gitlab-project-access` | L2 (Workload) | `terraform-vault-onboarding/terraform-vault-add-gitlab-project-access/` |
| `terraform-vault-add-kvv2` | L3 (Use-case) | `terraform-vault-onboarding/terraform-vault-add-kvv2/` |
| `terraform-vault-add-pgsql-role` | L3 (Use-case) | `terraform-vault-onboarding/terraform-vault-add-pgsql-role/` |
| `terraform-vault-add-permission-group` | L3 (Use-case) | `terraform-vault-onboarding/terraform-vault-add-permission-group/` |
| `terraform-vault-pgsql-onboarding` | L3 (Use-case) | `terraform-vault-onboarding/terraform-vault-pgsql-onboarding/` |

## Publish to the private registry

Each module must be published to your HCP Terraform private registry with **no-code provisioning** enabled. The plugin resolves modules by name at runtime using the HCP Terraform API.

### 1. Create a VCS connection

Connect your Terraform module repository to HCP Terraform as a [VCS provider](https://developer.hashicorp.com/terraform/cloud-docs/vcs). The module source directories listed above are subdirectories of a monorepo, so use the **module subdirectory** feature when publishing.

### 2. Publish each module

For each module, create a [no-code ready module](https://developer.hashicorp.com/terraform/cloud-docs/no-code-provisioning/module-design) in the private registry. The UI path works everywhere; the Terraform path automates all nine publishes in one apply.

=== "HCP Terraform UI"

    1. Go to your HCP Terraform organization's **Registry** page.
    2. Click **Publish** and select **Module**.
    3. Choose the VCS repository and set the module subdirectory path.
    4. Enable **No-code provisioning** on the module settings page.

=== "Terraform (tfe provider)"

    The [`tfe_registry_module`](https://registry.terraform.io/providers/hashicorp/tfe/latest/docs/resources/registry_module) resource publishes from a monorepo subdirectory through the `source_directory` argument (beta), and [`tfe_no_code_module`](https://registry.terraform.io/providers/hashicorp/tfe/latest/docs/resources/no_code_module) enables no-code provisioning:

    ```hcl
    locals {
      modules = {
        # registry name = source directory (one entry per row of the inventory table)
        "terraform-vault-cluster-onboarding" = "terraform-vault-onboarding/terraform-vault-cluster-onboarding"
        "terraform-vault-add-kvv2"           = "terraform-vault-onboarding/terraform-vault-add-kvv2"
        # ...
      }
    }

    resource "tfe_registry_module" "vault" {
      for_each        = local.modules
      organization    = var.organization
      name            = each.key   # must match the directory name for fast resolution
      module_provider = "vault"

      vcs_repo {
        display_identifier = var.vcs_repo   # for example "acme/self-service-vault"
        identifier         = var.vcs_repo
        oauth_token_id     = var.oauth_token_id
        branch             = "main"
        source_directory   = each.value
      }
    }

    resource "tfe_no_code_module" "vault" {
      for_each        = tfe_registry_module.vault
      organization    = var.organization
      registry_module = each.value.id
    }
    ```

The module name in the registry must match the directory name (such as `terraform-vault-cluster-onboarding`). The plugin tries multiple name variants when resolving, but an exact match is fastest.

### 3. Verify module resolution

After publishing all modules, run the preflight script from the `vault-backstage/` directory of your clone. Copy `.env.example` to `.env` and set `HCP_TF_ORGANIZATION` and `HCP_TF_TOKEN` first — the Makefile loads the file automatically:

```bash
make verify-hcptf
```

This confirms that every module can be resolved through the HCP Terraform API. [Verify the integration](verify.md) shows sample output and failure signatures. If resolution is slow, pre-populate the `hcpTerraform.moduleMap` in your `app-config.yaml` with the no-code module IDs the script prints.

## HCP Vault prerequisites

The modules expect an HCP Vault cluster with the following structure. This section is the specification your admin bootstrap must satisfy — the reference implementation ([Bootstrap the admin project](#bootstrap-the-admin-project)) is not public, so treat these subsections as the contract and reproduce them with your own Terraform or manual configuration:

### Admin namespace

The `admin` namespace must exist and contain:

- A **JWT auth mount** (default path `tf_jwt`) configured to trust HCP Terraform's OIDC issuer
- An **admin role** on that mount, bound to the admin project's workspaces

The `terraform-vault-hcptf-onboarding` module (L0) authenticates to the `admin` namespace and creates per-environment child namespaces under it.

### Admin project variable set

The HCP Terraform admin project (default name: `HCP Vault Admin`) must have a **project-scoped variable set** with the following variables:

| Variable | Category | Description |
|----------|----------|-------------|
| `TFC_VAULT_PROVIDER_AUTH` | env | Set to `true` to enable Vault dynamic provider credentials |
| `TFC_VAULT_ADDR` | env | HCP Vault cluster address |
| `TFC_VAULT_NAMESPACE` | env | `admin` |
| `TFC_VAULT_RUN_ROLE` | env | Admin JWT role name |
| `TFC_VAULT_AUTH_PATH` | env | JWT auth mount path (such as `tf_jwt`) |
| `TF_VAR_vault_address` | env | HCP Vault address (readable in module configuration) |
| `TFE_TOKEN` | env (sensitive) | Team token for managing projects and variable sets |

Refer to the [hcptf-onboarding module reference](../modules/hcptf-onboarding.md#no-code-provisioning) for details on how credentials reach the module.

## Bootstrap the admin project

The reference implementation bootstraps this structure with a private Terraform configuration that is not distributed with the portal, so build your own bootstrap that creates:

1. The admin project (default name `HCP Vault Admin`) in your HCP Terraform organization, with the [project-scoped variable set](#admin-project-variable-set).
2. The [JWT auth mount and admin role](#admin-namespace) in the Vault `admin` namespace, trusting HCP Terraform's OIDC issuer.

Scope your bootstrap to those two targets only — your HCP Terraform organization and the Vault `admin` namespace — and review the plan output before you approve the apply. If your organization has access to the reference bootstrap, running its apply does the same thing.

With the modules published and the admin project bootstrapped, install the [backend plugin](plugin.md).
