import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { EntityCardBlueprint } from '@backstage/plugin-catalog-react/alpha';
import type { Entity } from '@backstage/catalog-model';

/**
 * Adds a "Terraform outputs" info card to the overview of every vault-workspace
 * Resource ingested by the HCP Terraform backend, so users can read and copy the
 * handoff outputs to use in their own apps.
 */
const vaultWorkspaceOutputsCard = EntityCardBlueprint.make({
  name: 'vault-workspace-outputs',
  params: {
    type: 'info',
    filter: (entity: Entity) =>
      entity.kind === 'Resource' && entity.spec?.type === 'vault-workspace',
    loader: () =>
      import('./VaultWorkspaceOutputsCard').then(m => (
        <m.VaultWorkspaceOutputsCard />
      )),
  },
});

/**
 * Adds a "Next layer" card to every vault-workspace Resource with a button that
 * deep-links to the next-layer template, pre-selecting this workspace as parent.
 */
const vaultNextLayerCard = EntityCardBlueprint.make({
  name: 'vault-next-layer',
  params: {
    type: 'info',
    filter: (entity: Entity) =>
      entity.kind === 'Resource' && entity.spec?.type === 'vault-workspace',
    loader: () =>
      import('./VaultNextLayerCard').then(m => <m.VaultNextLayerCard />),
  },
});

export const catalogModule = createFrontendModule({
  pluginId: 'catalog',
  extensions: [vaultWorkspaceOutputsCard, vaultNextLayerCard],
});
