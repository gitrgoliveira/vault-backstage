# AGENTS.md — idp (Backstage Vault self-service portal)

Backstage internal developer portal that exposes the [`terraform-vault-onboarding`](../terraform-vault-onboarding) no-code modules as self-service software templates, and ingests the resulting HCP Terraform workspaces into the catalog. Uses the **new Backstage frontend system** (`@backstage/frontend-defaults`) plus a custom backend plugin.

Setup, toolchain, and configuration live in [`README.md`](README.md) — read it first. This file captures only the conventions and gotchas that codebase exploration alone won't reveal.

## Commands (single entry point: the Makefile)

Run everything through `make` — the targets encode required ordering and flags:

- `make check` — lint + full typecheck + tests (the pre-commit gate; expect lint 0, tsc 0, tests green).
- `make build` — runs `yarn tsc` (emits `dist-types/`) **then** `yarn build:all`. `yarn build:all` alone fails on a clean tree ("No declaration files found").
- `make verify-hcptf` — read-only HCP Terraform preflight (validate token, resolve no-code module IDs). Needs `.env`.
- `make dev` — run locally. `make help` lists all targets.

Conventions baked into the Makefile (don't re-introduce the bugs they fix):
- Tests run with `CI=true` so Jest runs **once**; a bare `yarn test`/`backstage-cli repo test` enters watch mode and hangs.
- `build`/`lint`/`tsc`/`test`/`dev` depend on a `node_modules` sentinel (auto-installs only when `package.json`/`yarn.lock` change) and `check-node` (Node `22 || 24 || 26`; `.nvmrc` = 26, required by `isolated-vm@7`).

## Layout

- [`plugins/hcp-terraform-backend/`](plugins/hcp-terraform-backend) — the core. `HcpTfClient.ts` (HCP TF JSON:API client), `HcpTerraformWorkspaceProvider.ts` (catalog EntityProvider), `actions/` (scaffolder actions), `module.ts` (registration), `config.d.ts` (typed `hcpTerraform` config).
- [`templates/`](templates) — 4 scaffolder templates. `metadata.name` is layer-ordinal-prefixed so the `/create` cards sort by layer (catalog default order is `metadata.name` asc): `vault-l0-admin-onboarding` (admin), `vault-l1-trust` (L1), `vault-l2-workload` (L2), `vault-l3-usecase` (L3). These are distinct from the same-layer `System` entities in [`catalog/`](catalog).
- [`catalog/`](catalog) — static entities (systems, modules, org). [`packages/app`](packages/app) — frontend (new frontend system). `packages/app/src/modules/catalog` holds the entity cards (`VaultWorkspaceOutputsCard`, `VaultNextLayerCard`) registered via `EntityCardBlueprint` in a `pluginId: 'catalog'` frontend module; `packages/app/src/modules/scaffolder` holds the `ScopedEntityPicker` custom field registered via `FormFieldBlueprint` in a `pluginId: 'scaffolder'` module; `@backstage/plugin-catalog-graph/alpha` is added in `App.tsx` for the relations graph. [`packages/backend`](packages/backend) — backend wiring. [`scripts/`](scripts) — `generate.mjs` (TechDocs), `verify-hcptf.mjs` (read-only preflight), `backfill-parent-tags.mjs` (infer + tag `parent:<name>` on pre-existing workspaces so the graph chains them; `make backfill-parent-tags`, dry-run unless `ARGS=--apply`).

## Non-negotiable conventions (verified; violating these silently breaks things)

- **Plugin-internal imports use explicit `.ts` extensions** (e.g. `from './module.ts'`). Required by TS `module: ES2020` + Backstage's CJS loader; `.js`/extensionless fail.
- **New imports must be declared in the importing package's `package.json`.** Backstage's `@backstage/no-undeclared-imports` lint fails the build for any `@backstage/*`, MUI, or npm import not listed as a dependency (e.g. adding a new card/field pulling `@backstage/plugin-scaffolder-react`, `@material-ui/lab`, or `react-use`). Add it with `yarn --cwd packages/app add <pkg>` (pin to the versions already resolved in the lockfile) and re-run `yarn install`.
- **Output annotation keys use a single dot:** `hcptf.io/output.<key>` — Backstage forbids a second `/` in the name segment. `hcptf.io/output/<key>` fails the catalog policy check and drops the entity.
- **Backstage tags must be lowercase** `[a-z0-9+#]` separated by `-`; lowercase tenant/env before using them as tags.
- **`createTemplateAction` is Zod v4:** field-function schemas and the two-arg `z.record(z.string(), z.string())` form.
- **HCP TF list endpoints must paginate** via `requestAllPages` (follows `meta.pagination['next-page']`); `page[size]=100` alone silently truncates at 100.
- **`listWorkspaces` uses `?include=current_run`** to get real run status (`latest-run` is deprecated/relationship-only, not includable). Do not switch to `include=latest_run` (400s → breaks the whole refresh).
- **`createWorkspace` payload is correct as written:** `data.relationships.vars.data[]` (type `"vars"`) and `data.relationships.project.data.type = "project"` (singular), per the no-code provisioning API. Do NOT "fix" it to `attributes.variables`/type `"projects"` — that is the regular workspace-vars API.
- **Onboarded tenants are discovered from the admin project's `terraform-vault-hcptf-onboarding` workspace outputs** (`project_ids`/`project_names` maps), not from a project name/tag scan. Configure via `hcpTerraform.projects.adminProjectName`/`adminProjectId`.
- **Workspace ingestion is gated on TWO conditions:** the `source-module-id` must resolve to a Vault-suite module (`layerForModule`) AND the workspace's project must be `Product:Vault`-tagged (`listVaultProjects`, skipped only if the org has zero tagged projects). This keeps unrelated no-code workspaces (rds, terramino, vpc, …) out of the catalog.
- **`source-module-id` yields the SHORT registry name** (`add-kvv2`), but `MODULE_LAYER` keys are the full `terraform-vault-*` names, so `layerForModule` tries both. A short/long mismatch here silently labels every workspace `unknown` — regression-tested in `HcpTerraformWorkspaceProvider.test.ts`. The `hcptf.io/module-name` annotation is normalized to the full name via `canonicalModuleName`, because template `catalogFilter`s (the pgsql/gitlab parent pickers) match on the full `terraform-vault-*` name.
- **Layer chaining (graph):** the provision action tags each child workspace `parent:<name>` (from the template's parent EntityPicker); the provider reads that tag and emits `spec.dependsOn` so the catalog graph shows the L1→L2→L3 chain. Only workspaces created after this change are linked (existing ones have no parent tag). Workspace resources are also enriched with `hcptf.io/tenant|environment|target` from their project (matched to a `vault-target` by project id); `hcptf.io/target` is the vault-target entity name the `VaultNextLayerCard` pre-selects when deep-linking to the next template via `?formData=`.
- **Catalog default filter is `all`** (`catalog-filter:catalog/list` in `app-config.yaml`). With guest/dev auth the user owns nothing, so the default `owned` filter renders an empty catalog.
- **Templates** pass a resolved `projectId` (from a `catalog:fetch` of a `vault-target` entity) plus parent handoff outputs (entity_id, auth_role_name, jwt_auth_path, …) via `EntityPicker` + `catalog:fetch`. Conditional fields use `dependencies.oneOf`; conditional steps use `if:` (`===`/`||`); output coalescing uses the nunjucks `or`.
- **Parent-workspace pickers use `ui:field: ScopedEntityPicker`** (custom field in `packages/app/src/modules/scaffolder`, registered on `pluginId: scaffolder`). It behaves like `EntityPicker` but filters candidates to the tenant/env selected in a sibling field via `ui:options.scopeField: onboardedTarget` (matching the workspace's `hcptf.io/target` annotation), so a use-case can't be linked to a parent in a different tenant. The `onboardedTarget` picker itself stays a plain `EntityPicker` (it is the scope source). It reads siblings through `props.formContext.formData`.
- **KV use-case is workload-type aware:** the L3 template offers `kvv2` (Kubernetes) and `kvv2-gitlab` (GitLab) use-case types; both call `terraform-vault-add-kvv2` but pass `integration_type` (`kubernetes`/`gitlab`), which selects the module's single `consumption_examples` output. The GitLab branch derives `workload_name` (the module input) from the selected workload and skips the K8s-only fields.
- **`hcptf:nocode:provision` waits for the run** (`waitForRun`) and fails the step on run failure — a 201 on workspace create is not success.
- **The destroy action (`hcptf:run:create`) is opt-in** (`hcpTerraform.actions.enableDestroy`, default false) and has no per-owner check; gate destruction to the owner before wiring it into a template.

## Security

- **Never echo `HCP_TF_TOKEN`.** `.env` is gitignored; the token is a config secret (`@visibility secret`). Redact `Bearer` in any command output. Provisioning is read/mutate against a live HCP Terraform org — treat `make verify-hcptf` (read-only) as the safe default and get explicit go-ahead before real provisioning.
