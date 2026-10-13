# Scaffolder templates

The portal provides four scaffolder templates that map to the [4-layer onboarding model](../architecture.md). Each template is a standalone YAML file that you register in your Backstage catalog.

## Register the templates

Copy the `templates/` directory into your Backstage project, then add each template as a catalog location in your `app-config.yaml`:

```yaml
catalog:
  locations:
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

Adjust the `target` paths relative to your `packages/backend/` directory.

## Template summary

| Template ID | Layer | Audience | Terraform module |
|-------------|-------|----------|-----------------|
| `vault-l0-admin-onboarding` | L0 | Platform team | `terraform-vault-hcptf-onboarding` |
| `vault-l1-trust` | L1 | Platform team | `terraform-vault-cluster-onboarding` or `terraform-vault-gitlab-onboarding` |
| `vault-l2-workload` | L2 | Application teams | `terraform-vault-add-k8s-namespace-access` or `terraform-vault-add-gitlab-project-access` |
| `vault-l3-usecase` | L3 | Application teams | `terraform-vault-add-kvv2`, `terraform-vault-add-pgsql-role`, `terraform-vault-add-permission-group`, or `terraform-vault-pgsql-onboarding` |

## How templates chain together

Templates at L1 and above use **Entity Picker** fields that reference entities created by earlier layers:

1. **L0** creates tenant projects and namespaces. The catalog provider ingests these as `vault-target` resources.
2. **L1** uses an Entity Picker filtered to `vault-target` resources to select the tenant. It creates trust workspaces ingested as `vault-workspace` resources.
3. **L2** uses a Scoped Entity Picker scoped to the selected tenant. The Kubernetes path filters `vault-workspace` resources by `hcptf.io/layer=trust`, while the GitLab path filters by `hcptf.io/module-name=terraform-vault-gitlab-onboarding`.
4. **L3** uses a Scoped Entity Picker filtered to `vault-workspace` resources with the workload layer, scoped to the selected tenant.

This means the catalog entity provider from the [backend plugin](plugin.md) must be running before L1 through L3 templates can populate their pickers.

## Customizing templates

### Change the owner

Each template declares `spec.owner: group:default/vault-platform`. Update this to match your organization's group entity:

```yaml
spec:
  owner: group:default/your-platform-team
```

### Add or remove environments

The L0 template defaults to `[dev, test, prod]` environments. To change the available options, edit the `environments` parameter in `templates/vault-admin-onboarding/template.yaml`:

```yaml
environments:
  title: Environments
  type: array
  items:
    type: string
    enum:
      - dev
      - staging
      - prod
```

Also update `hcpTerraform.projects.namingPattern` in `app-config.yaml` if your project naming convention differs. The template YAML is the only place that controls which environment options appear on the form.

### Add authentication gates

The reference templates do not enforce authorization checks on the scaffolder actions. To restrict who can run a template, use Backstage's built-in template permissions:

- Set `spec.metadata.tags` to restrict visibility on the Create page using catalog permissions.
- Use `backstage.io/template-output-links` and step-level `if` conditions to gate execution based on user identity.
- Configure the Backstage permission framework to restrict the `scaffolder.template.execute` permission to specific groups.

Refer to the [Backstage software templates authorization documentation](https://backstage.io/docs/features/software-templates/writing-templates/#authorizing-parameters-steps-and-actions) for details on parameter-level and step-level authorization.

### Conditional fields

The L1, L2, and L3 templates use `if` / `then` blocks inside `spec.parameters` to show fields conditionally based on the selected type (cluster or GitLab, Kubernetes or GitLab, and use-case variant). If you add a new workload or use-case type, add a corresponding conditional block and map it to a new `hcptf:nocode:provision` step.

With all five components installed, [verify the integration](verify.md) end to end.
