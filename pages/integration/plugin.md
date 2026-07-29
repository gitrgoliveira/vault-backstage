# HCP Terraform backend plugin

The `@gitrgoliveira/plugin-hcp-terraform-backend` package provides two backend modules:

- **Scaffolder module** registers three scaffolder actions for provisioning and reading HCP Terraform workspaces.
- **Catalog module** registers an entity provider that syncs HCP Terraform workspaces into the Backstage catalog as `Resource` entities.

## Install the plugin

The plugin is published to [GitHub Packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry) as `@gitrgoliveira/plugin-hcp-terraform-backend`. GitHub Packages requires authentication even for public packages: create a [personal access token (classic)](https://github.com/settings/tokens) with the `read:packages` scope, then point the `@gitrgoliveira` scope at the registry and install.

=== "Yarn 4 (Backstage default)"

    Add the scope to your app's `.yarnrc.yml`, referencing the token through an environment variable so it never enters version control:

    ```yaml
    npmScopes:
      gitrgoliveira:
        npmRegistryServer: "https://npm.pkg.github.com"
        npmAuthToken: "${GITHUB_PACKAGES_TOKEN:-}"
    ```

    ```bash
    export GITHUB_PACKAGES_TOKEN=your-token
    cd packages/backend
    yarn add @gitrgoliveira/plugin-hcp-terraform-backend
    ```

=== "npm / classic Yarn"

    Add the scope and token to `~/.npmrc` — keep tokens out of version control:

    ```ini
    @gitrgoliveira:registry=https://npm.pkg.github.com
    //npm.pkg.github.com/:_authToken=YOUR_TOKEN
    ```

    ```bash
    cd packages/backend
    npm install @gitrgoliveira/plugin-hcp-terraform-backend
    ```

!!! note "Docker builds"
    The token must also be available when your backend image runs `yarn install`. Mount it as a build secret (for example `RUN --mount=type=secret,...`) rather than copying it into a layer.

??? info "Alternative: vendor from source"
    To consume the plugin as a workspace package instead, copy `plugins/hcp-terraform-backend/` from your clone of the reference portal ([Get the source](index.md#get-the-source)) into your project's `plugins/` folder, add `"plugins/*"` to the `workspaces.packages` list in your root `package.json`, and run `yarn add @gitrgoliveira/plugin-hcp-terraform-backend@workspace:plugins/hcp-terraform-backend` from `packages/backend`.

## Register the backend modules

In `packages/backend/src/index.ts`, import and add both modules:

```typescript
import {
  hcpTerraformScaffolderModule,
  hcpTerraformCatalogModule,
} from '@gitrgoliveira/plugin-hcp-terraform-backend';

// After other backend.add() calls:
backend.add(hcpTerraformScaffolderModule);
backend.add(hcpTerraformCatalogModule);
```

The scaffolder module registers these actions:

| Action ID | Purpose |
|-----------|---------|
| `hcptf:nocode:provision` | Creates a no-code HCP Terraform workspace, applies the module, and polls for completion |
| `hcptf:outputs:read` | Reads current state-version outputs from a workspace |
| `hcptf:run:create` | Queues a destroy run on a workspace. The action only supports `isDestroy: true` and throws an error for any other value. Requires `actions.enableDestroy: true` in `app-config.yaml`; disabled by default. |

The catalog module registers the `HcpTerraformWorkspaceProvider`, which refreshes every 5 minutes and emits:

- **`vault-workspace`** resources for every workspace created from a known Vault module (filtered by the `Product:Vault` project tag)
- **`vault-target`** resources for each tenant and environment pair discovered from L0 onboarding outputs

## Configure `app-config.yaml`

Add the `hcpTerraform` section to your `app-config.yaml`:

```yaml
hcpTerraform:
  organization: ${HCP_TF_ORGANIZATION}
  token: ${HCP_TF_TOKEN}
  # Optional: override for Terraform Enterprise
  # baseUrl: ${HCP_TF_BASE_URL:-https://app.terraform.io}
  projects:
    namingPattern: "{tenant}-Vault-{env}"
    adminProjectName: ${HCP_TF_ADMIN_PROJECT_NAME:-HCP Vault Admin}
    productTag:
      key: Product
      value: Vault
```

Set `HCP_TF_TOKEN` and `HCP_TF_ORGANIZATION` in your deployment environment before starting. All other environment variables shown in the YAML snippet have defaults and are optional.

### Configuration reference

| Key | Required | Description |
|-----|----------|-------------|
| `organization` | Yes | HCP Terraform organization name |
| `token` | Yes | Team token with workspace, project, variable set, and no-code module permissions |
| `baseUrl` | No | API base URL. Defaults to `https://app.terraform.io`. Set this for Terraform Enterprise. |
| `projects.namingPattern` | No | Pattern for resolving tenant projects. Defaults to `{tenant}-Vault-{env}`. |
| `projects.adminProjectName` | No | Name of the admin project containing the Vault credentials variable set. Defaults to `HCP Vault Admin`. |
| `projects.adminProjectId` | No | Project ID override. If set, skips the name-based lookup. |
| `projects.productTag.key` | No | Tag key used to identify Vault projects. Defaults to `Product`. |
| `projects.productTag.value` | No | Tag value used to identify Vault projects. Defaults to `Vault`. |
| `projects.tenantTagKey` | No | Tag key the catalog provider reads from workspace tags to identify the tenant when a workspace cannot be matched to a project. The tag must be set on workspaces externally, for example by the Terraform module. Defaults to `tenant`. |
| `moduleMap` | No | Object mapping module names to no-code module IDs. Pre-populating this avoids API lookups on each provision. |
| `actions.enableDestroy` | No | Enable the `hcptf:run:create` destroy action. Defaults to `false`. Read [Enable destroy runs](#enable-destroy-runs) before setting this. |

### Enable destroy runs

!!! danger "No per-owner authorization check"
    The `hcptf:run:create` action accepts any `workspaceId` in your organization and can queue a destroy run against it — the plugin performs no check that the requesting user owns the workspace. Only set `actions.enableDestroy: true` alongside a template that restricts the `workspaceId` input to workspaces owned by the requesting user, or a permission policy that gates `scaffolder.template.execute` for the destroy template. When the action is enabled, the backend logs a warning at startup as a reminder.

### Optional: pre-populate the module map

The plugin resolves no-code module IDs by querying the HCP Terraform API at runtime. To skip the API lookup and speed up provisioning, add a `moduleMap`:

```yaml
hcpTerraform:
  moduleMap:
    terraform-vault-hcptf-onboarding: nocode-abc123
    terraform-vault-cluster-onboarding: nocode-def456
    # ... one entry per module
```

The [verification step](#verify) prints the correct IDs for your organization.

## Permission policy

The reference implementation includes a permission policy that restricts `catalog.entity.delete` to entity owners. All other actions are allowed. If your Backstage instance already has a permission policy, merge the rules rather than replacing your existing policy:

```typescript
import {
  isResourcePermission,
  AuthorizeResult,
} from '@backstage/plugin-permission-common';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';

// Inside your PermissionPolicy handle() method:
if (
  isResourcePermission(request.permission, 'catalog-entity') &&
  request.permission.name === 'catalog.entity.delete'
) {
  return createCatalogConditionalDecision(request.permission, {
    anyOf: [
      catalogConditions.isEntityOwner({
        claims: user?.info.ownershipEntityRefs ?? [],
      }),
    ],
  });
}

return { result: AuthorizeResult.ALLOW };
```

!!! warning "Production note"
    The `ALLOW` catch-all is safe only when your Backstage instance uses a real identity provider. The reference `app-config.yaml` enables the `guest: {}` provider, which grants every browser session an authenticated identity. Combined with the catch-all, the scaffolder is open to anyone who can reach the instance. Before you deploy to production, replace `guest: {}` with a real provider (`app-config.yaml` already contains a GitLab SSO configuration) or add an explicit guard for scaffolder execution to this policy. Refer to [Add authentication gates](templates.md#add-authentication-gates).

## Verify

After configuring the backend plugin, restart your Backstage backend and run the read-only preflight script — `make verify-hcptf` in the reference portal clone. It validates your token, resolves all no-code module IDs, and confirms the admin project exists. [Verify the integration](verify.md) explains how to run the script in your own instance and shows sample output and failure signatures.

With the backend green, proceed to the [frontend plugin](plugin-frontend.md) installation.
