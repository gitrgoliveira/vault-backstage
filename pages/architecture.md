# Architecture

The Vault Self-Service Portal uses a layered onboarding model. Each layer builds on the one below it, and each is backed by one or more no-code Terraform modules managed through HCP Terraform.

```
┌──────────────────────────────────────────────────────┐
│  L3 — Use-case                                       │
│  KVv2 · PostgreSQL role · Permission group · PgSQL   │
│  Grants a workload access to a specific secret type  │
├──────────────────────────────────────────────────────┤
│  L2 — Workload                                       │
│  K8s namespace access · GitLab project access        │
│  Registers a workload as a Vault identity            │
├──────────────────────────────────────────────────────┤
│  L1 — Trust                                          │
│  Cluster onboarding · GitLab onboarding              │
│  Mounts JWT auth backends for OIDC trust             │
├──────────────────────────────────────────────────────┤
│  L0 — Admin / Tenant                                 │
│  HCP Terraform onboarding                            │
│  Creates projects, namespaces, and variable sets     │
└──────────────────────────────────────────────────────┘
```

## Layer dependencies

Layers must be provisioned in order. The portal reads the selected parent workspace's outputs from the catalog and passes its scope names to the next module as variables; each module derives its auth paths, role names and entity names from those, so the layers line up without typed-in values.

- **L0 → L1**: Trust workspaces are placed inside the tenant's HCP Terraform project, inheriting the Vault credentials variable set.
- **L1 → L2**: Workload modules take the trust's `cluster_name` (Kubernetes) or `gitlab_instance_name` (GitLab) and derive the JWT mount path from it.
- **L2 → L3**: Use-case modules take the workload's scope name and `workload_name` and look up the workload entity by `<scope>-<workload>` to bind an identity group.

## Backstage catalog model

The portal maps these layers to Backstage catalog entities:

| Backstage kind | Entity type | Maps to |
|----------------|-------------|---------|
| `Domain` | `vault-self-service` | The overall platform |
| `System` | `vault-admin`, `vault-trust`, `vault-workload`, `vault-usecase` | One per layer (L0–L3) |
| `Component` | `terraform-module` | Each Terraform module |
| `Resource` | `vault-target` | Per-tenant/environment target created by L0 |
| `Resource` | `vault-workspace` | Each HCP Terraform workspace created by templates |
| `Template` | `infrastructure` | The 4 scaffolder templates |

## Data flow

```
User fills form in Backstage
        │
        ▼
Scaffolder calls hcptf:nocode:provision
        │
        ▼
HCP Terraform creates workspace + applies no-code module
        │
        ▼
Vault resources provisioned (auth backends, entities, policies, mounts)
        │
        ▼
Catalog provider ingests the workspace on its next refresh (≤ 5 min)
```

## Integration points

| System | Role |
|--------|------|
| **Backstage** | UI, catalog, scaffolder templates |
| **HCP Terraform** | Workspace management, no-code module execution, state |
| **HashiCorp Vault** | Secret management, auth backends, policies |
| **Kubernetes** | OIDC trust through ServiceAccount tokens |
| **GitLab** | OIDC trust through CI/CD ID tokens |
