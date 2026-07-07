# Vault backstage onboarding

This is your newly scaffolded Backstage App for the internal Vault IDP.

The **Create** page surfaces the self-service Vault onboarding templates — trust (Layer 1), principal (Layer 2), and use-case (Layer 3), plus admin tenant onboarding:

![Backstage Create page listing the Vault onboarding templates](screenshots/create-page.png)

## Required Terraform module repositories

The portal does not provision anything itself — it drives a suite of **no-code Terraform modules** published to the HCP Terraform private registry. Each template on the Create page maps to one or more of these modules, so the portal only works when all of them are published and reachable. They follow a layered dependency chain (`trust → principal → use-case`), bootstrapped by the admin tenant-onboarding module.

| Layer | Module repository | Purpose |
|---|---|---|
| Admin / bootstrap | [terraform-vault-hcptf-onboarding](https://github.com/gitrgoliveira/terraform-vault-hcptf-onboarding) | Bootstraps tenant onboarding into HCP Terraform and Vault namespaces. |
| Trust (Layer 1) | [terraform-vault-cluster-onboarding](https://github.com/gitrgoliveira/terraform-vault-cluster-onboarding) | Creates a Vault JWT auth backend for Kubernetes/OpenShift cluster trust. |
| Trust (Layer 1) | [terraform-vault-gitlab-onboarding](https://github.com/gitrgoliveira/terraform-vault-gitlab-onboarding) | Creates a Vault JWT auth backend for GitLab instance trust. |
| Principal (Layer 2) | [terraform-vault-add-k8s-namespace-access](https://github.com/gitrgoliveira/terraform-vault-add-k8s-namespace-access) | Onboards a Kubernetes namespace/service account as a Vault principal. |
| Principal (Layer 2) | [terraform-vault-add-gitlab-project-access](https://github.com/gitrgoliveira/terraform-vault-add-gitlab-project-access) | Onboards a GitLab project as a Vault principal. |
| Use-case (Layer 3) | [terraform-vault-add-kvv2](https://github.com/gitrgoliveira/terraform-vault-add-kvv2) | Provisions KVv2 access and identity group bindings for a principal. |
| Use-case (Layer 3) | [terraform-vault-add-pgsql-role](https://github.com/gitrgoliveira/terraform-vault-add-pgsql-role) | Provisions PostgreSQL static role access through the Vault DB engine. |
| Use-case (Layer 3) | [terraform-vault-add-permission-group](https://github.com/gitrgoliveira/terraform-vault-add-permission-group) | Grants custom ACL capabilities over Vault paths to principals. |
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
