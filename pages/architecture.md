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
│  Registers a principal as a Vault identity           │
├──────────────────────────────────────────────────────┤
│  L1 — Trust                                          │
│  Cluster onboarding · GitLab onboarding              │
│  Mounts JWT auth backends for OIDC trust             │
├──────────────────────────────────────────────────────┤
│  L0 — Admin / Tenant                                 │
│  HCP TF onboarding                                   │
│  Creates projects, namespaces, and variable sets     │
└──────────────────────────────────────────────────────┘
```

## Layer dependencies

Layers must be provisioned in order. Each layer's Terraform module reads outputs from the layer below via HCP Terraform workspace data sharing.

- **L0 → L1**: Trust workspaces are placed inside the tenant's HCP TF project, inheriting the Vault credentials variable set.
- **L1 → L2**: Workload modules reference the `jwt_auth_path` and `jwt_mount_accessor` outputs from the trust workspace.
- **L2 → L3**: Use-case modules look up the workload entity by name to bind an identity group.

## Backstage catalog model

The portal maps these layers to Backstage catalog entities:

| Backstage kind | Entity type | Maps to |
|----------------|-------------|---------|
| `Domain` | `vault-self-service` | The overall platform |
| `System` | `vault-trust`, `vault-workload`, `vault-usecase` | One per layer (L1–L3) |
| `Component` | `terraform-module` | Each Terraform module |
| `Resource` | `vault-target` | Per-tenant/environment target created by L0 |
| `Resource` | `vault-workspace` | Each HCP TF workspace created by templates |
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
Backstage catalog updated with new Resource entity
```

## Integration points

| System | Role |
|--------|------|
| **Backstage** | UI, catalog, scaffolder templates |
| **HCP Terraform** | Workspace management, no-code module execution, state |
| **HashiCorp Vault** | Secret management, auth backends, policies |
| **Kubernetes** | OIDC trust via ServiceAccount tokens |
| **GitLab** | OIDC trust via CI/CD ID tokens |
