# `terraform-vault-hcptf-onboarding/`: per-tenant environment onboarding

A no-code ready module that onboards one tenant onto HCP Vault from HCP Terraform. One invocation onboards one tenant across all of its environments, looping over `var.environments`. For each environment it creates a `<tenant>-Vault-<env>` HCP Terraform project, a `<tenant>` child namespace under the matching environment namespace in HCP Vault, the JWT trust inside that namespace, and a variable set that wires future workspaces in the project to authenticate automatically.

## Inputs

| Name | Type | Default | Description |
|---|---|---|---|
| `environments` | `list(string)` | `["dev", "test", "prod"]` | Environments to onboard for the tenant |
| `project_tags` | `map(string)` | `{ Product = "Vault" }` | Tag bindings applied to each `<tenant>-Vault-<env>` project; workspaces created in the project inherit them as effective tags |
| `tenant` | `string` | none | Tenant name; used in project names and the tenant namespace path |
| `vault_address` | `string` | `""` | HCP Vault address; supplied by the `TF_VAR_vault_address` env var from the project variable set |
| `vault_auth_path` | `string` | `"tf_jwt"` | JWT auth mount path inside each tenant namespace |
| `vault_role_name` | `string` | `"hcp-tf"` | JWT role name created in each tenant namespace |

The HCP Terraform organization is derived from `TFC_WORKSPACE_SLUG`, and the Vault address arrives as `var.vault_address`, populated by the `TF_VAR_vault_address` environment variable that the project variable set supplies. Both are provided through HCP Terraform; do not set them manually.

## Outputs

| Name | Description |
|---|---|
| `project_ids` | Map env to `<tenant>-Vault-<env>` project ID |
| `project_names` | Map env to `<tenant>-Vault-<env>` project name |
| `role_names` | Map env to JWT role name |
| `tenant_namespace_paths` | Map env to tenant namespace `path_fq` (relative to the admin namespace, such as `<env>/<tenant>`) |
| `variable_set_ids` | Map env to variable set ID |
| `vault_namespaces` | Map env to the fully qualified Vault namespace from the cluster root (`admin/<env>/<tenant>`) |

## No-code provisioning

This is a [no-code ready module](https://developer.hashicorp.com/terraform/cloud-docs/no-code-provisioning/module-design): it configures its own `vault` and `tfe` providers, so HCP Terraform can provision it without a hand-written caller.

Grant the no-code workspaces their credentials with a **project-scoped variable set** applied to the project where the module lands. The module's `vault` provider authenticates to the `admin` namespace using Vault dynamic provider credentials, and its `tfe` provider manages org-level projects and variable sets:

| Variable | Category | Value |
|---|---|---|
| `TFC_VAULT_PROVIDER_AUTH` | env | `true` |
| `TFC_VAULT_ADDR` | env | HCP Vault address |
| `TFC_VAULT_NAMESPACE` | env | `admin` (the namespace the module manages) |
| `TFC_VAULT_RUN_ROLE` | env | the admin JWT role |
| `TFC_VAULT_AUTH_PATH` | env | JWT auth mount path (for example `tf_jwt`) |
| `TF_VAR_vault_address` | env | HCP Vault address, read by the module as `var.vault_address` |
| `TFE_TOKEN` | env (sensitive) | team token able to manage projects and variable sets |

### How credentials and identifiers reach the module

HCP Terraform turns those `TFC_VAULT_*` variables into [Vault dynamic provider credentials](https://developer.hashicorp.com/terraform/cloud-docs/dynamic-provider-credentials/vault-configuration): for each run it authenticates with the admin JWT role and injects `VAULT_ADDR`, `VAULT_NAMESPACE`, and a short-lived token into the run environment. The module's `vault` provider reads those directly, so it sets only `skip_child_token = true` with no `address`, `namespace`, or `token` arguments.

Those are *environment* variables, and Terraform configuration cannot read environment variables directly. Only variables passed as `TF_VAR_*`, or values fetched through the `external` data source, are readable in configuration (see [Reading and using environment variables in Terraform runs](https://support.hashicorp.com/hc/en-us/articles/4547786359571-Reading-and-using-environment-variables-in-Terraform-runs)). So the two values the module needs *in configuration* arrive through Terraform input variables instead:

* **Organization name** comes from `TFC_WORKSPACE_SLUG`. HCP Terraform injects a fixed set of [run-environment variables](https://developer.hashicorp.com/terraform/cloud-docs/workspaces/run/run-environment) and also exposes them as same-named Terraform input variables, so `var.TFC_WORKSPACE_SLUG` (form `<org>/<workspace>`) yields the organization.
* **Vault address** comes from `var.vault_address`, populated by the `TF_VAR_vault_address` environment variable that the project variable set supplies. (`TF_VAR_`-prefixed env vars are the supported way to feed an environment value into a Terraform variable.) The plain `TFC_VAULT_ADDR` that authenticates the provider is *not* readable in configuration, which is why the admin variable set delivers the address a second time as `TF_VAR_vault_address`.

The module copies that address into `TFC_VAULT_ADDR` on each `<tenant>-Vault-<env>` variable set it creates, so the tenant's future workspaces authenticate to the same Vault. Neither value is a hand-entered module argument.

## Isolation

Each `vault_jwt_auth_backend_role` pins authentication with `bound_claims` on
`terraform_project_id` and `terraform_organization_name`, so only workspaces in
the matching `<tenant>-Vault-<env>` project can authenticate. Each role also lives
in a distinct `admin/<env>/<tenant>` namespace, a second boundary.

---

## Terraform reference (generated)

_Generated by `make generate` from `hcp-vault-base-setup/terraform-vault-hcptf-onboarding`. Do not edit by hand._

## Requirements

| Name | Version |
| ---- | ------- |
| <a name="requirement_terraform"></a> [terraform](#requirement\_terraform) | >= 1.9 |
| <a name="requirement_tfe"></a> [tfe](#requirement\_tfe) | ~> 0.78 |
| <a name="requirement_vault"></a> [vault](#requirement\_vault) | ~> 5.10 |

## Providers

| Name | Version |
| ---- | ------- |
| <a name="provider_tfe"></a> [tfe](#provider\_tfe) | 0.78.0 |
| <a name="provider_vault"></a> [vault](#provider\_vault) | 5.10.0 |

## Modules

No modules.

## Resources

| Name | Type |
| ---- | ---- |
| [tfe_project.env](https://registry.terraform.io/providers/hashicorp/tfe/latest/docs/resources/project) | resource |
| [tfe_project_variable_set.env](https://registry.terraform.io/providers/hashicorp/tfe/latest/docs/resources/project_variable_set) | resource |
| [tfe_variable.env](https://registry.terraform.io/providers/hashicorp/tfe/latest/docs/resources/variable) | resource |
| [tfe_variable_set.env](https://registry.terraform.io/providers/hashicorp/tfe/latest/docs/resources/variable_set) | resource |
| [vault_jwt_auth_backend.env](https://registry.terraform.io/providers/hashicorp/vault/latest/docs/resources/jwt_auth_backend) | resource |
| [vault_jwt_auth_backend_role.env](https://registry.terraform.io/providers/hashicorp/vault/latest/docs/resources/jwt_auth_backend_role) | resource |
| [vault_namespace.tenant](https://registry.terraform.io/providers/hashicorp/vault/latest/docs/resources/namespace) | resource |
| [vault_policy.env](https://registry.terraform.io/providers/hashicorp/vault/latest/docs/resources/policy) | resource |

## Inputs

| Name | Description | Type | Default | Required |
| ---- | ----------- | ---- | ------- | :------: |
| <a name="input_TFC_WORKSPACE_SLUG"></a> [TFC\_WORKSPACE\_SLUG](#input\_TFC\_WORKSPACE\_SLUG) | Workspace slug injected by HCP Terraform. Used to derive the organization name. | `string` | `""` | no |
| <a name="input_environments"></a> [environments](#input\_environments) | Environments to onboard for the tenant. | `list(string)` | <pre>[<br/>  "dev",<br/>  "test",<br/>  "prod"<br/>]</pre> | no |
| <a name="input_project_tags"></a> [project\_tags](#input\_project\_tags) | Tag bindings applied to each <tenant>-Vault-<env> project. Workspaces created in the project inherit them as effective tags. | `map(string)` | <pre>{<br/>  "Product": "Vault"<br/>}</pre> | no |
| <a name="input_tenant"></a> [tenant](#input\_tenant) | Tenant name. Used in project names and the tenant namespace path. | `string` | n/a | yes |
| <a name="input_vault_address"></a> [vault\_address](#input\_vault\_address) | HCP Vault address, supplied by the TF\_VAR\_vault\_address environment variable from the project variable set. Written into the downstream tenant variable sets. | `string` | `""` | no |
| <a name="input_vault_auth_path"></a> [vault\_auth\_path](#input\_vault\_auth\_path) | JWT auth mount path inside each tenant namespace. | `string` | `"tf_jwt"` | no |
| <a name="input_vault_role_name"></a> [vault\_role\_name](#input\_vault\_role\_name) | JWT role name created in each tenant namespace. | `string` | `"hcp-tf"` | no |

## Outputs

| Name | Description |
| ---- | ----------- |
| <a name="output_project_ids"></a> [project\_ids](#output\_project\_ids) | Map of environment name to <tenant>-Vault-<env> HCP Terraform project ID. |
| <a name="output_project_names"></a> [project\_names](#output\_project\_names) | Map of environment name to <tenant>-Vault-<env> HCP Terraform project name. |
| <a name="output_role_names"></a> [role\_names](#output\_role\_names) | Map of environment name to the JWT role name in the tenant namespace. |
| <a name="output_tenant_namespace_paths"></a> [tenant\_namespace\_paths](#output\_tenant\_namespace\_paths) | Map of environment name to the fully qualified tenant namespace path. |
| <a name="output_variable_set_ids"></a> [variable\_set\_ids](#output\_variable\_set\_ids) | Map of environment name to the per-project variable set ID. |
| <a name="output_vault_namespaces"></a> [vault\_namespaces](#output\_vault\_namespaces) | Map of environment name to the fully qualified Vault namespace from the cluster root (admin/<env>/<tenant>); use as VAULT\_NAMESPACE. |
