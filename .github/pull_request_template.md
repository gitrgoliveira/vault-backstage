## Summary

<!-- What changes and why, in a few sentences. Link the issue if there is one. -->

## Changes

<!-- Bullet the notable changes, grouped by area (templates, catalog, backend plugin, frontend, scripts, docs). -->

-

## Validation

<!-- Tick what you ran and paste short evidence (counts, exit codes). Say why if you skipped something. -->

- [ ] `make check` passes (lint 0, tsc 0, tests green)
- [ ] `make generate` re-run if upstream module READMEs or variables changed; it regenerates `docs/`, so don't hand-edit there (needs `terraform-docs`)
- [ ] `make verify-hcptf` (read-only) if HCP Terraform client, provider or config changed
- [ ] Templates exercised in `make dev` (`/create`), if templates changed; `make screenshots` re-run if a form changed

## Deployment notes

<!-- Anything an operator must know: renamed entities/templates, changed annotation or tag values,
     config keys, one-off scripts to run (e.g. `make backfill-parent-tags`). Write "None" if not applicable. -->

## Checklist

See [`AGENTS.md`](../AGENTS.md) for the reasoning behind each item.

- [ ] New imports are declared in the importing package's `package.json`
- [ ] Output annotation keys use a single dot (`hcptf.io/output.<key>`); tags are lowercase
- [ ] Renamed template / System / annotation values are updated everywhere they are read (templates, `catalog/`, provider, frontend cards/filters, scripts)
- [ ] `AGENTS.md` / `README.md` updated if conventions or layout changed
- [ ] No secrets committed; `HCP_TF_TOKEN` is not echoed in logs or output
