import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import catalogGraphPlugin from '@backstage/plugin-catalog-graph/alpha';
import {
  vaultCatalogModule,
  vaultScaffolderModule,
} from '@gitrgoliveira/plugin-vault-frontend';
import { navModule } from './modules/nav';
import { homeModule } from './modules/home';

export default createApp({
  features: [
    catalogPlugin,
    catalogGraphPlugin,
    navModule,
    homeModule,
    vaultCatalogModule,
    vaultScaffolderModule,
  ],
});
