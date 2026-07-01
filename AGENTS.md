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
- [`templates/`](templates) — 4 scaffolder templates: `vault-trust` (L1), `vault-principal` (L2), `vault-usecase` (L3), `vault-admin-onboarding` (admin).
- [`catalog/`](catalog) — static entities (systems, modules, org). [`packages/app`](packages/app) — frontend. [`packages/backend`](packages/backend) — backend wiring. [`scripts/`](scripts) — `generate.mjs` (TechDocs) + `verify-hcptf.mjs`.

## Non-negotiable conventions (verified; violating these silently breaks things)

- **Plugin-internal imports use explicit `.ts` extensions** (e.g. `from './module.ts'`). Required by TS `module: ES2020` + Backstage's CJS loader; `.js`/extensionless fail.
- **Output annotation keys use a single dot:** `hcptf.io/output.<key>` — Backstage forbids a second `/` in the name segment. `hcptf.io/output/<key>` fails the catalog policy check and drops the entity.
- **Backstage tags must be lowercase** `[a-z0-9+#]` separated by `-`; lowercase tenant/env before using them as tags.
- **`createTemplateAction` is Zod v4:** field-function schemas and the two-arg `z.record(z.string(), z.string())` form.
- **HCP TF list endpoints must paginate** via `requestAllPages` (follows `meta.pagination['next-page']`); `page[size]=100` alone silently truncates at 100.
- **`listWorkspaces` uses `?include=current_run`** to get real run status (`latest-run` is deprecated/relationship-only, not includable). Do not switch to `include=latest_run` (400s → breaks the whole refresh).
- **`createWorkspace` payload is correct as written:** `data.relationships.vars.data[]` (type `"vars"`) and `data.relationships.project.data.type = "project"` (singular), per the no-code provisioning API. Do NOT "fix" it to `attributes.variables`/type `"projects"` — that is the regular workspace-vars API.
- **Onboarded tenants are discovered from the admin project's `terraform-vault-hcptf-onboarding` workspace outputs** (`project_ids`/`project_names` maps), not from a project name/tag scan. Configure via `hcpTerraform.projects.adminProjectName`/`adminProjectId`.
- **Catalog default filter is `all`** (`catalog-filter:catalog/list` in `app-config.yaml`). With guest/dev auth the user owns nothing, so the default `owned` filter renders an empty catalog.
- **Templates** pass a resolved `projectId` (from a `catalog:fetch` of a `vault-target` entity) plus parent handoff outputs (entity_id, auth_role_name, jwt_auth_path, …) via `EntityPicker` + `catalog:fetch`. Conditional fields use `dependencies.oneOf`; conditional steps use `if:` (`===`/`||`); output coalescing uses the nunjucks `or`.
- **`hcptf:nocode:provision` waits for the run** (`waitForRun`) and fails the step on run failure — a 201 on workspace create is not success.
- **The destroy action (`hcptf:run:create`) is opt-in** (`hcpTerraform.actions.enableDestroy`, default false) and has no per-owner check; gate destruction to the owner before wiring it into a template.

## Security

- **Never echo `HCP_TF_TOKEN`.** `.env` is gitignored; the token is a config secret (`@visibility secret`). Redact `Bearer` in any command output. Provisioning is read/mutate against a live HCP Terraform org — treat `make verify-hcptf` (read-only) as the safe default and get explicit go-ahead before real provisioning.
