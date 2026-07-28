# Vault backstage onboarding

This is your newly scaffolded Backstage App for the internal Vault IDP.

The **Create** page surfaces the self-service Vault onboarding templates — trust (Layer 1), workload (Layer 2), and use-case (Layer 3), plus admin tenant onboarding:

![Backstage Create page listing the Vault onboarding templates](screenshots/create-page.png)

## Required Terraform module repositories

The portal does not provision anything itself — it drives a suite of **no-code Terraform modules** published to the HCP Terraform private registry. Each template on the Create page maps to one or more of these modules, so the portal only works when all of them are published and reachable. They follow a layered dependency chain (`trust → workload → use-case`), bootstrapped by the admin tenant-onboarding module.

| Layer | Module repository | Purpose |
|---|---|---|
| Admin / bootstrap | [terraform-vault-hcptf-onboarding](https://github.com/gitrgoliveira/terraform-vault-hcptf-onboarding) | Bootstraps tenant onboarding into HCP Terraform and Vault namespaces. |
| Trust (Layer 1) | [terraform-vault-cluster-onboarding](https://github.com/gitrgoliveira/terraform-vault-cluster-onboarding) | Creates a Vault JWT auth backend for Kubernetes/OpenShift cluster trust. |
| Trust (Layer 1) | [terraform-vault-gitlab-onboarding](https://github.com/gitrgoliveira/terraform-vault-gitlab-onboarding) | Creates a Vault JWT auth backend for GitLab instance trust. |
| Workload (Layer 2) | [terraform-vault-add-k8s-namespace-access](https://github.com/gitrgoliveira/terraform-vault-add-k8s-namespace-access) | Onboards a Kubernetes namespace/service account as a Vault workload identity. |
| Workload (Layer 2) | [terraform-vault-add-gitlab-project-access](https://github.com/gitrgoliveira/terraform-vault-add-gitlab-project-access) | Onboards a GitLab project as a Vault workload identity. |
| Use-case (Layer 3) | [terraform-vault-add-kvv2](https://github.com/gitrgoliveira/terraform-vault-add-kvv2) | Provisions KVv2 access and identity group bindings for a workload. |
| Use-case (Layer 3) | [terraform-vault-add-pgsql-role](https://github.com/gitrgoliveira/terraform-vault-add-pgsql-role) | Provisions PostgreSQL static role access through the Vault DB engine. |
| Use-case (Layer 3) | [terraform-vault-add-permission-group](https://github.com/gitrgoliveira/terraform-vault-add-permission-group) | Grants custom ACL capabilities over Vault paths to workloads. |
| Use-case (Layer 3) | [terraform-vault-pgsql-onboarding](https://github.com/gitrgoliveira/terraform-vault-pgsql-onboarding) | Onboards the PostgreSQL secrets engine and connection (prerequisite for `terraform-vault-add-pgsql-role`). |

Map each module name to its `nocode-xxxx` registry ID via `hcpTerraform.moduleMap` in [`app-config.yaml`](app-config.yaml) (or let the backend resolve them at runtime). Use `make verify-hcptf` for a read-only preflight that validates the token and resolves every module ID.

Use the Makefile as the single entry point.

Toolchain policy (verified):

- Node: `24` recommended (`22` also supported by Backstage here). This repo includes `.nvmrc` and `.node-version` pinned to `24`.
- Yarn: `4.13.0` (from scaffolded repo config).
- Backstage CLI: `0.36.3` (current latest on npm at implementation time).

Check active versions:

```sh
make versions
```

To get started:

```sh
make install
make dev
```

Useful commands:

```sh
make help
make check
make build
```

Configuration:

- Copy `.env.example` to `.env` and set `HCP_TF_TOKEN`.
- Configure `hcpTerraform` settings in `app-config.yaml` and optional overrides via environment variables.

## Reuse in your own Backstage instance

This repository is a complete Backstage app, so the simplest path — if you do not already run Backstage — is to clone or fork it and follow the getting-started steps above. If you already operate a Backstage instance, integrate the reusable parts below.

> **Prerequisites / caveats (verify before you start):**
> - Your app must use the **new Backstage frontend system** (`@backstage/frontend-defaults`, `createApp({ features: [...] })`) — the frontend modules below register that way and will not load in a legacy `createApp`/`App.tsx` route setup.
> - Both reusable plugins use the `@internal` scope. They can be installed from npm once published to a registry, or consumed directly as workspace packages (copy the directory and wire in `package.json`).
> - The [nine no-code modules](#required-terraform-module-repositories) must already be published to *your* HCP Terraform organization's private registry.

**1. Backend plugin.**

- **Option A (npm, once published):** `yarn add @internal/plugin-hcp-terraform-backend`
- **Option B (workspace):** Copy [`plugins/hcp-terraform-backend/`](plugins/hcp-terraform-backend) into your `plugins/` directory and add the workspace dependency to `packages/backend/package.json`:

```json
"@internal/plugin-hcp-terraform-backend": "workspace:plugins/hcp-terraform-backend"
```

Then wire the modules in [`packages/backend/src/index.ts`](packages/backend/src/index.ts):

```ts
import { hcpTerraformScaffolderModule, hcpTerraformCatalogModule } from '@internal/plugin-hcp-terraform-backend';

backend.add(hcpTerraformScaffolderModule); // scaffolder actions (provision/destroy no-code workspaces)
backend.add(hcpTerraformCatalogModule);    // vault-workspace catalog entity provider
```

Optional: copy `packages/backend/src/permissions.ts` and `backend.add(vaultIdpPermissionModule)` for the owner-gated destroy policy.

**2. Frontend plugin.**

- **Option A (npm, once published):** `yarn add @internal/plugin-vault-frontend`
- **Option B (workspace):** Copy [`plugins/vault-frontend/`](plugins/vault-frontend) into your `plugins/` directory and add the workspace dependency to `packages/app/package.json`:

```json
"@internal/plugin-vault-frontend": "workspace:plugins/vault-frontend"
```

Then wire the modules in [`packages/app/src/App.tsx`](packages/app/src/App.tsx):

```ts
import { vaultCatalogModule, vaultScaffolderModule } from '@internal/plugin-vault-frontend';

export default createApp({
  features: [/* ...existing... */, vaultCatalogModule, vaultScaffolderModule],
});
```

**3. Catalog entities and templates.** Copy the [`catalog/`](catalog) and [`templates/`](templates) directories and register them under `catalog.locations` in your `app-config.yaml` (see this repo's file for the four templates plus the module/system/org entities).

**4. Configuration.** Add the `hcpTerraform:` block to your `app-config.yaml`, set `HCP_TF_TOKEN` and `HCP_TF_ORGANIZATION` in `.env`, and populate `hcpTerraform.moduleMap` with your `nocode-xxxx` registry IDs (or rely on runtime resolution). Validate with `make verify-hcptf` (read-only).

**5. TechDocs (optional).** Copy [`docs/`](docs) for the per-module documentation, or regenerate it from the module READMEs with `make generate` (requires `terraform-docs` on `PATH`).
