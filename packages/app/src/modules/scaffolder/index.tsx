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
        // A ScopedEntityPicker is only ever used for a parent workspace that is
        // required in every branch that renders it, so an empty selection is
        // always invalid. RJSF does not reliably enforce `required` for fields
        // nested in `dependencies.oneOf`, which lets an empty value reach the
        // scaffolder and fail `catalog:fetch` with an opaque "Missing entity
        // reference". This validator blocks submission with an actionable message.
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

export const scaffolderModule = createFrontendModule({
  pluginId: 'scaffolder',
  extensions: [scopedEntityPickerField],
});
