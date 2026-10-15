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

1. **L0** creates tenant projects and namespaces. The catalog provider ingests these as `vault-target` resources, but only from L0 workspaces in the admin project named by `hcpTerraform.projects.adminProjectName`, so the L0 form's Admin Project Name must match it.
2. **L1** uses an Entity Picker filtered to `vault-target` resources to select the tenant and environment. It creates trust workspaces ingested as `vault-workspace` resources.
3. **L2** uses Scoped Entity Pickers scoped to the selected tenant and environment (the `hcptf.io/target` annotation). The Kubernetes path lists `terraform-vault-cluster-onboarding` workspaces that have a `cluster_name` output; the GitLab path lists `terraform-vault-gitlab-onboarding` workspaces that have a `gitlab_instance_name` output.
4. **L3** uses Scoped Entity Pickers scoped the same way, filtered per use-case type:

| Use-case type | Parent workspace module | Required parent output |
|---------------|-------------------------|------------------------|
| `kvv2` | `terraform-vault-add-k8s-namespace-access` | `workload_name` |
| `kvv2-gitlab` | `terraform-vault-add-gitlab-project-access` | `workload_name` |
| `pgsql-role` | `terraform-vault-add-k8s-namespace-access`, plus a `terraform-vault-pgsql-onboarding` workspace | `workload_name`; `db_mount_path` on the connection |
| `permission-group` | any workload-layer workspace | `workload_name` |
| `pgsql-connection` | none | none |

A `pgsql-connection` run must apply before any `pgsql-role` run can select it.

So a parent appears in a picker only after the catalog entity provider from the [backend plugin](plugin.md) has ingested it: its run must have applied (pickers require the output annotation), and the provider refreshes every 5 minutes.

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

- Hide a template from users who should not see it with a conditional `catalog.entity.read` decision in your permission policy, for example one that matches the template's kind and name or an annotation you add to it.
- Restrict who can start a task with `scaffolder.task.create`, or who can run the provisioning action with `scaffolder.action.execute` (conditional on the action ID `hcptf:nocode:provision`).
- Tag individual parameters or steps with `backstage:permissions` and gate them through `scaffolder.template.parameter.read` and `scaffolder.template.step.read`.

Refer to the [Backstage software templates authorization documentation](https://backstage.io/docs/features/software-templates/writing-templates/#authorizing-parameters-steps-and-actions) for details on parameter-level and step-level authorization.

### Conditional fields

The L1, L2, and L3 templates use JSON Schema `dependencies` with a `oneOf` branch per type inside `spec.parameters` to show fields conditionally based on the selected type (cluster or GitLab, Kubernetes or GitLab, and use-case variant). If you add a new workload or use-case type, add a `oneOf` branch and map it to a new `hcptf:nocode:provision` step guarded by a step-level `if:`. A new module also needs an entry in the backend plugin's `MODULE_LAYER` map (`moduleLayer.ts`), or the provider skips its workspaces.

With all five components installed, [verify the integration](verify.md) end to end.
