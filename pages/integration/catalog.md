# Catalog entities

The portal ships three catalog definition files that populate the Backstage catalog with the domain model, Terraform module components, and a placeholder organization.

## Register catalog locations

Add the catalog files as locations in your `app-config.yaml`:

```yaml
catalog:
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
```

Adjust the `target` paths relative to your `packages/backend/` directory.

## Domain and systems

`catalog/domain-and-systems.yaml` defines the top-level catalog structure:

| Kind | Name | Description |
|------|------|-------------|
| Domain | `vault-self-service` | The Vault self-service platform domain |
| System | `vault-trust` | Trust layer modules that establish auth backends |
| System | `vault-workload` | Workload layer modules that onboard identities |
| System | `vault-usecase` | Use-case layer modules that grant access and policies |

All entities are owned by `group:default/vault-platform`.

## Module components

`catalog/modules.yaml` defines nine `Component` entities of type `terraform-module`. Each component carries annotations used by the catalog entity provider and the scaffolder templates:

| Annotation | Purpose |
|------------|---------|
| `hcptf.io/module-name` | Maps the component to the HCP Terraform no-code module |
| `hcptf.io/layer` | Identifies the onboarding layer (`trust`, `workload`, or `usecase`) |
| `hcptf.io/outputs` | Comma-separated list of Terraform output names surfaced as entity annotations |
| `backstage.io/techdocs-ref` | Points to the TechDocs site for the module |

The modules are assigned to systems: trust modules belong to `vault-trust`, workload modules to `vault-workload`, and use-case modules to `vault-usecase`.

## Organization

`catalog/org.yaml` defines a placeholder group and user:

- **Group:** `vault-platform` (type `team`)
- **User:** `guest` (member of `vault-platform`)

Replace these with your real organization structure. If your Backstage instance already has org entities from an identity provider (such as GitLab or GitHub), update the `spec.owner` references in the domain, system, module, and template entities to point to your existing groups.

## Dynamic entities from the provider

In addition to the static catalog entities above, the [HCP Terraform catalog provider](plugin.md) creates dynamic `Resource` entities at runtime:

| Resource type | Created when | Annotations |
|---------------|-------------|-------------|
| `vault-target` | A tenant is onboarded (L0) | `hcptf.io/tenant`, `hcptf.io/environment`, `hcptf.io/project-id` |
| `vault-workspace` | Any template runs | `hcptf.io/workspace-id`, `hcptf.io/module-name`, `hcptf.io/layer`, `hcptf.io/run-status`, `hcptf.io/tenant`, `hcptf.io/environment`, plus `hcptf.io/output.<key>` for each non-sensitive output |

These resources appear in Entity Picker fields in the L1 through L3 templates. The provider refreshes every 5 minutes.

!!! note
    The provider labels `terraform-vault-hcptf-onboarding` workspaces with the `trust` layer even though the module serves the L0 admin function. This label is cosmetic: the `vault-target` resources that the template pickers rely on are emitted from the module's outputs, not from this label, so no action is needed.

## Allowed entity kinds

Make sure your catalog rules allow the entity kinds used by the portal:

```yaml
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
```

With the catalog populated, register the [scaffolder templates](templates.md).
