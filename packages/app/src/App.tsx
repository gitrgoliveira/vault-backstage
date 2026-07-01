import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import catalogGraphPlugin from '@backstage/plugin-catalog-graph/alpha';
import { navModule } from './modules/nav';
import { catalogModule } from './modules/catalog';
import { scaffolderModule } from './modules/scaffolder';

export default createApp({
  features: [
    catalogPlugin,
    catalogGraphPlugin,
    navModule,
    catalogModule,
    scaffolderModule,
  ],
});
