# Vault frontend plugin

The `@gitrgoliveira/plugin-vault-frontend` package provides UI components for the catalog entity pages and a custom scaffolder field used by the L1 through L3 templates.

## Install the plugin

The plugin is published to GitHub Packages as `@gitrgoliveira/plugin-vault-frontend`. Configure the `@gitrgoliveira` registry scope and token as described in the [backend plugin installation](plugin.md#install-the-plugin), then add the package to your app:

```bash
cd packages/app
yarn add @gitrgoliveira/plugin-vault-frontend
```

??? info "Alternative: vendor from source"
    Copy `plugins/vault-frontend/` from your clone of the reference portal ([Get the source](index.md#get-the-source)) into your project's `plugins/` folder alongside the backend plugin, then run `yarn add @gitrgoliveira/plugin-vault-frontend@workspace:plugins/vault-frontend` from `packages/app`.

## Register the frontend modules

The plugin targets Backstage's [new frontend system](https://backstage.io/docs/frontend-system/): `createApp` comes from `@backstage/frontend-defaults` and accepts a `features` array. If your app uses the classic `createApp` from `@backstage/app-defaults`, [migrate the app](https://backstage.io/docs/frontend-system/building-apps/migrating/) before registering these modules.

In `packages/app/src/App.tsx`, import and register both frontend modules:

```typescript
import { createApp } from '@backstage/frontend-defaults';
import {
  vaultCatalogModule,
  vaultScaffolderModule,
} from '@gitrgoliveira/plugin-vault-frontend';

export default createApp({
  features: [
    // ... other features
    vaultCatalogModule,
    vaultScaffolderModule,
  ],
});
```

## What the modules provide

The **catalog module** (`vaultCatalogModule`) registers three extensions. The two entity cards appear on the detail pages of `vault-workspace` Resource entities; the Layer filter appears as a facet in the catalog list page sidebar:

| Extension | Description |
|-----------|-------------|
| Terraform outputs card | Displays all `hcptf.io/output.*` annotations as a key-value table with copy buttons |
| Next layer card | Shows a button linking to the next onboarding template (L1 trust links to L2 workload, L2 workload links to L3 use-case) and pre-populates the scaffolder form with the current entity's context |
| Layer filter | Adds a "Layer" facet to the catalog list page, filtering entities by `hcptf.io/layer` annotation |

The **scaffolder module** (`vaultScaffolderModule`) registers one custom field:

| Field | Description |
|-------|-------------|
| Scoped Entity Picker | A filtered entity picker that narrows results based on the tenant selected in another form field. Used by the L1 through L3 templates to scope trust, workload, and use-case selections to the correct tenant. |

No additional `app-config.yaml` keys are required. The entity cards appear automatically on any `Resource` entity with `spec.type: vault-workspace`.

Next, import the [catalog entities](catalog.md) that the entity cards and template pickers rely on.
