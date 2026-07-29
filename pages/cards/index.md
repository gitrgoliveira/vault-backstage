# Template Cards

The portal surfaces four template cards on the Backstage **Create** page. Each card is a guided form that provisions Vault infrastructure through HCP Terraform — no Terraform code required.

![All four template cards on the Create page](../img/create-page.png)

## Card overview

| Card | Layer | Audience | Description |
|------|-------|----------|-------------|
| [Vault Tenant Onboarding (Admin)](admin-onboarding.md) | L0 | Platform team | Creates HCP TF projects, Vault namespaces, trust, and variable sets for a new tenant |
| [Vault Trust Onboarding](trust-onboarding.md) | L1 | Platform team | Mounts a JWT auth backend for a Kubernetes cluster or GitLab instance |
| [Vault Principal Onboarding](workload-onboarding.md) | L2 | App teams | Registers a Kubernetes ServiceAccount or GitLab project as a Vault identity |
| [Vault Use-case Onboarding](usecase-onboarding.md) | L3 | App teams | Grants KVv2, PostgreSQL role, custom ACL, or PostgreSQL connection access |

## Execution flow

Every card follows the same pattern:

1. User clicks **CHOOSE** on the card
2. Fills in the form fields (1 step per card, with conditional fields based on selections)
3. Clicks **Create**
4. The scaffolder runs the `hcptf:nocode:provision` action
5. An HCP Terraform workspace is created and the no-code module is applied
6. Links to the workspace and run are returned

!!! info "Entity Pickers"
    Cards at L1 and above include **Entity Picker** fields that list only the relevant upstream entities. For example, the Trust card shows only `vault-target` Resources created by the Admin card. If the picker is empty, you need to run the upstream template first.
