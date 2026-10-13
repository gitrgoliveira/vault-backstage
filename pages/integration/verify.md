# Verify the integration

This page closes the integration: a read-only preflight script that proves your HCP Terraform configuration end to end, followed by a portal walkthrough that confirms each component is live. Nothing on this page creates, modifies, or destroys infrastructure.

## Copy the preflight script

The preflight script lives at `scripts/verify-hcptf.mjs` in the reference portal. It validates your team token and resolves every no-code module referenced by the scaffolder templates, using only your organization name. It never prints the token.

Copy it from your clone ([Get the source](index.md#get-the-source)) into your Backstage project:

```bash
mkdir -p scripts
cp <clone>/vault-backstage/scripts/verify-hcptf.mjs scripts/
```

The script discovers module names by reading `templates/*/template.yaml` relative to its own location, so place it in a `scripts/` directory whose parent contains the `templates/` directory you copied in [Scaffolder templates](templates.md). In the reference portal, `make verify-hcptf` runs the same script.

## Run the preflight

=== "Your Backstage instance"

    ```bash
    export HCP_TF_ORGANIZATION=your-org
    export HCP_TF_TOKEN=your-team-token
    node scripts/verify-hcptf.mjs
    ```

=== "Reference portal clone"

    ```bash
    make verify-hcptf
    ```

    The Makefile loads `HCP_TF_ORGANIZATION` and `HCP_TF_TOKEN` from the `.env` file in `vault-backstage/`.

Set `HCP_TF_BASE_URL` as well if you use Terraform Enterprise.

Successful output looks like this:

```text
HCP Terraform preflight for org "your-org" (https://app.terraform.io)
✔ Token valid. 9 Vault provider modules, 9 no-code enabled.

✔ 2 Vault-tagged projects (Product=Vault): ridgeline-Vault-dev, ridgeline-Vault-prod
  Onboarded tenant/env targets: ridgeline/dev, ridgeline/prod

Module resolution:
  ✔ terraform-vault-hcptf-onboarding -> terraform-vault-hcptf-onboarding (vault) -> nocode-AbC123
  ✔ terraform-vault-cluster-onboarding -> terraform-vault-cluster-onboarding (vault) -> nocode-DeF456
  ...

9/9 modules ready for no-code provisioning.
```

The `nocode-...` IDs in the module resolution lines are the values for the optional [`moduleMap`](plugin.md#optional-pre-populate-the-module-map). A fresh organization with no onboarded tenants shows `(none)` for projects and targets — that is normal before the first L0 run.

## Failure signatures

| Output | Cause | Remedy |
|--------|-------|--------|
| `✖ HCP_TF_ORGANIZATION is not set (edit .env).` | The environment variables are not exported in the current shell. The reference portal reads them from a `.env` file; outside it, export them directly. | Export `HCP_TF_ORGANIZATION` and `HCP_TF_TOKEN` before running. |
| `GET /api/v2/... -> 401` | The token is invalid, expired, or not a team token. | Generate a new team token with workspace, project, variable set, and no-code module permissions, as listed in [Prerequisites](index.md#prerequisites). |
| `✖ <module>: no enabled Vault no-code module matched (tried: ...)` | The module is not published, no-code provisioning is not enabled on it, or the registry name does not match any tried variant. | Revisit [Publish each module](terraform-modules.md#2-publish-each-module): confirm the module appears in the private registry and has **No-code provisioning** enabled. |

The script exits with a non-zero status when no modules resolve, so you can use it as a CI gate.

## Check your app-config.yaml

The integration steps add configuration in three places: the `hcpTerraform` block ([backend plugin](plugin.md)), the catalog locations and rules ([catalog entities](catalog.md)), and the template locations ([scaffolder templates](templates.md)). A missing `catalog.rules` kind fails silently — entities never appear — so compare your file against the merged result:

??? example "Complete app-config.yaml additions"

    ```yaml
    hcpTerraform:
      organization: ${HCP_TF_ORGANIZATION}
      token: ${HCP_TF_TOKEN}
      projects:
        namingPattern: "{tenant}-Vault-{env}"

    catalog:
      rules:
        - allow:
            - Component
            - System
            - API
            - Resource
            - Location
            - Domain
            - Group
            - User
            - Template
      locations:
        - type: file
          target: ../../catalog/domain-and-systems.yaml
          rules:
            - allow: [Domain, System]
        - type: file
          target: ../../catalog/modules.yaml
          rules:
            - allow: [Component]
        - type: file
          target: ../../catalog/org.yaml
          rules:
            - allow: [Group, User]
        - type: file
          target: ../../templates/vault-admin-onboarding/template.yaml
          rules:
            - allow: [Template]
        - type: file
          target: ../../templates/vault-trust/template.yaml
          rules:
            - allow: [Template]
        - type: file
          target: ../../templates/vault-workload/template.yaml
          rules:
            - allow: [Template]
        - type: file
          target: ../../templates/vault-usecase/template.yaml
          rules:
            - allow: [Template]
    ```

    The `catalog` and `locations` keys merge with whatever your instance already declares; the snippet shows only what this integration adds.

## Confirm the portal end to end

With the preflight green, restart your Backstage backend and walk the portal:

- [ ] **Catalog structure**: the catalog shows the `vault-self-service` domain and the `vault-trust`, `vault-workload`, and `vault-usecase` systems.
- [ ] **Module components**: the nine `terraform-module` components appear, each linking to its TechDocs page.
- [ ] **Templates**: the Create page lists the four templates (L0 admin onboarding through L3 use case).
- [ ] **Provider sync**: after the first L0 run, `vault-target` resources appear within one refresh cycle (5 minutes), and the L1 template's Entity Picker offers them.
- [ ] **Entity cards**: opening a `vault-workspace` resource shows the Terraform outputs card and the next-layer navigation card.

When every box is checked, the integration is complete. Your platform team can onboard the first real tenant through the L0 template — the [template cards](../cards/index.md) walk each form field for all four layers.

## Remove the integration

To back out, reverse the install order:

1. Remove the template and catalog `locations` entries this integration added to `app-config.yaml`.
2. Remove `vaultCatalogModule` and `vaultScaffolderModule` from `App.tsx`, remove the two `backend.add(...)` calls from your backend, then delete the `plugins/hcp-terraform-backend/` and `plugins/vault-frontend/` directories and their `package.json` dependencies.
3. Delete any remaining `vault-workspace` and `vault-target` entities from the catalog — with the provider gone, nothing removes them for you.
4. Destroy provisioned tenant workspaces from HCP Terraform before you tear down the admin bootstrap; then destroy whatever your bootstrap created (the admin project and the JWT trust). Destroying the admin project while tenant workspaces still exist orphans their Vault credentials.
5. Delete the nine modules from your private registry if nothing else uses them.
