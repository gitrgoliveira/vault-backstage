import { createFrontendModule } from '@backstage/frontend-plugin-api';
import {
  FormFieldBlueprint,
  createFormField,
} from '@backstage/plugin-scaffolder-react/alpha';

const scopedEntityPickerField = FormFieldBlueprint.make({
  name: 'scoped-entity-picker',
  params: {
    field: async () => {
      const { ScopedEntityPicker } = await import('../components/ScopedEntityPicker');
      return createFormField({
        name: 'ScopedEntityPicker',
        component: ScopedEntityPicker,
        validation: (value, fieldValidation) => {
          const selected = typeof value === 'string' ? value.trim() : '';
          if (!selected) {
            fieldValidation.addError(
              'Select a parent workspace. If the list is empty, provision the ' +
                'prerequisite lower-layer workspace in this tenant/environment first.',
            );
          }
        },
      });
    },
  },
});

export const vaultScaffolderModule = createFrontendModule({
  pluginId: 'scaffolder',
  extensions: [scopedEntityPickerField],
});
