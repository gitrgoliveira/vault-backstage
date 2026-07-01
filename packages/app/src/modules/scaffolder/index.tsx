import { createFrontendModule } from '@backstage/frontend-plugin-api';
import {
  FormFieldBlueprint,
  createFormField,
} from '@backstage/plugin-scaffolder-react/alpha';

/**
 * Registers the {@link ScopedEntityPicker} custom scaffolder field under the
 * name `ScopedEntityPicker`, so templates can use `ui:field: ScopedEntityPicker`
 * to restrict parent-workspace pickers to the selected tenant/environment.
 */
const scopedEntityPickerField = FormFieldBlueprint.make({
  name: 'scoped-entity-picker',
  params: {
    field: async () => {
      const { ScopedEntityPicker } = await import('./ScopedEntityPicker');
      return createFormField({
        name: 'ScopedEntityPicker',
        component: ScopedEntityPicker,
      });
    },
  },
});

export const scaffolderModule = createFrontendModule({
  pluginId: 'scaffolder',
  extensions: [scopedEntityPickerField],
});
