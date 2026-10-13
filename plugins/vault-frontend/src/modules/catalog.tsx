import { createFrontendModule } from '@backstage/frontend-plugin-api';
import {
  CatalogFilterBlueprint,
  EntityCardBlueprint,
} from '@backstage/plugin-catalog-react/alpha';
import type { Entity } from '@backstage/catalog-model';

const isVaultWorkspace = (entity: Entity) =>
  entity.kind === 'Resource' && entity.spec?.type === 'vault-workspace';

const vaultWorkspaceOutputsCard = EntityCardBlueprint.make({
  name: 'vault-workspace-outputs',
  params: {
    type: 'info',
    filter: isVaultWorkspace,
    loader: () =>
      import('../components/VaultWorkspaceOutputsCard').then(m => (
        <m.VaultWorkspaceOutputsCard />
      )),
  },
});

const vaultNextLayerCard = EntityCardBlueprint.make({
  name: 'vault-next-layer',
  params: {
    type: 'info',
    filter: isVaultWorkspace,
    loader: () =>
      import('../components/VaultNextLayerCard').then(m => <m.VaultNextLayerCard />),
  },
});

const vaultLayerFilter = CatalogFilterBlueprint.make({
  name: 'vault-layer',
  params: {
    loader: () =>
      import('../components/VaultLayerPicker').then(m => <m.VaultLayerPicker />),
  },
});

export const vaultCatalogModule = createFrontendModule({
  pluginId: 'catalog',
  extensions: [vaultWorkspaceOutputsCard, vaultNextLayerCard, vaultLayerFilter],
});
