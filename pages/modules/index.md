# Terraform Modules

The portal is backed by 9 no-code Terraform modules published to an HCP Terraform private registry. Each module handles one specific operation in the [4-layer onboarding model](../architecture.md).

## Module inventory

### Trust layer (L1)

| Module | Description |
|--------|-------------|
| [`terraform-vault-cluster-onboarding`](cluster-onboarding.md) | Creates a Vault JWT auth backend for Kubernetes/OpenShift cluster trust |
| [`terraform-vault-gitlab-onboarding`](gitlab-onboarding.md) | Creates a Vault JWT auth backend for GitLab instance trust |
| [`terraform-vault-hcptf-onboarding`](hcptf-onboarding.md) | Bootstraps tenant onboarding into HCP Terraform and Vault namespaces |

### Workload layer (L2)

| Module | Description |
|--------|-------------|
| [`terraform-vault-add-k8s-namespace-access`](add-k8s-namespace-access.md) | Onboards a Kubernetes namespace/service account as a Vault workload identity |
| [`terraform-vault-add-gitlab-project-access`](add-gitlab-project-access.md) | Onboards a GitLab project as a Vault workload identity |

### Use-case layer (L3)

| Module | Description |
|--------|-------------|
| [`terraform-vault-add-kvv2`](add-kvv2.md) | Provisions KVv2 access and identity group bindings for a workload |
| [`terraform-vault-add-pgsql-role`](add-pgsql-role.md) | Provisions PostgreSQL static role access through Vault DB engine |
| [`terraform-vault-add-permission-group`](add-permission-group.md) | Grants custom ACL capabilities over Vault paths to workloads |
| [`terraform-vault-pgsql-onboarding`](pgsql-onboarding.md) | Onboards PostgreSQL secrets engine and connection for downstream roles |

## Generating module docs

Module documentation is generated from `terraform-docs` output and the module README files:

```bash
make generate
```

This produces:

- TechDocs sites under `docs/<module>/` for the Backstage Docs tab
- Variable inventories under `generated/variables/<module>.json` for the scaffolder
