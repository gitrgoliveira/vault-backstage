import {
  createBackendModule,
  coreServices,
} from '@backstage/backend-plugin-api';
import {
  scaffolderActionsExtensionPoint,
} from '@backstage/plugin-scaffolder-node';
import {
  catalogProcessingExtensionPoint,
} from '@backstage/plugin-catalog-node';
import { HcpTfClient } from './HcpTfClient';
import { HcpTerraformWorkspaceProvider } from './HcpTerraformWorkspaceProvider';
import { createProvisionAction } from './actions/provision';
import { createOutputsReadAction } from './actions/outputs';
import { createRunAction } from './actions/run';

/** Registers hcptf:* scaffolder actions into the scaffolder plugin. */
export const hcpTerraformScaffolderModule = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'hcp-terraform',
  register(env) {
    env.registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ scaffolderActions, config, logger }) {
        const client = new HcpTfClient(config, logger);
        const actions: unknown[] = [
          createProvisionAction(client),
          createOutputsReadAction(client),
        ];
        // The destroy action has no per-owner authorization check, so it is
        // opt-in. Only enable it alongside a template that gates destruction
        // to the workspace owner.
        const enableDestroy =
          config.getOptionalBoolean('hcpTerraform.actions.enableDestroy') ?? false;
        if (enableDestroy) {
          actions.push(createRunAction(client));
          logger.warn(
            'hcptf:run:create destroy action is ENABLED; ensure the template ' +
              'that uses it restricts destruction to the workspace owner.',
          );
        }
        scaffolderActions.addActions(...(actions as any[]));
        logger.info('HCP Terraform scaffolder actions registered');
      },
    });
  },
});

/** Registers HcpTerraformWorkspaceProvider into the catalog plugin. */
export const hcpTerraformCatalogModule = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'hcp-terraform-workspace-provider',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, config, logger, scheduler }) {
        const client = new HcpTfClient(config, logger);
        const provider = HcpTerraformWorkspaceProvider.create({
          config,
          client,
          logger,
          scheduler,
        });
        catalog.addEntityProvider(provider);
        logger.info('HCP Terraform workspace EntityProvider registered');
      },
    });
  },
});
