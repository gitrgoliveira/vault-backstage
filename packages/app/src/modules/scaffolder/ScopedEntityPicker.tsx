import { CATALOG_FILTER_EXISTS } from '@backstage/catalog-client';
import type { EntityFilterQuery } from '@backstage/catalog-client';
import {
  Entity,
  parseEntityRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { ScaffolderField } from '@backstage/plugin-scaffolder-react/alpha';
import type { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import TextField from '@material-ui/core/TextField';
import Autocomplete from '@material-ui/lab/Autocomplete';
import { useMemo } from 'react';
import useAsync from 'react-use/esm/useAsync';

/**
 * `ui:options` accepted by {@link ScopedEntityPicker}.
 */
export type ScopedEntityPickerUiOptions = {
  /** Static catalog filter, same shape as EntityPicker's `catalogFilter`. */
  catalogFilter?: Record<string, unknown> | Record<string, unknown>[];
  /**
   * Name of a sibling form field whose selected entity defines the scope
   * (e.g. `onboardedTarget`). Only candidates whose `scopeAnnotation` equals
   * that entity's name are shown.
   */
  scopeField?: string;
  /**
   * Candidate annotation compared against the scope entity's name.
   * Defaults to `hcptf.io/target`.
   */
  scopeAnnotation?: string;
};

function convertOpsValue(value: unknown): string | symbol {
  if (value && typeof value === 'object' && (value as { exists?: unknown }).exists) {
    return CATALOG_FILTER_EXISTS;
  }
  return String(value);
}

function toQuery(
  filters: Record<string, unknown>,
): Record<string, string | symbol | (string | symbol)[]> {
  const query: Record<string, string | symbol | (string | symbol)[]> = {};
  for (const [key, value] of Object.entries(filters)) {
    query[key] = Array.isArray(value)
      ? (value.map(convertOpsValue) as (string | symbol)[])
      : convertOpsValue(value);
  }
  return query;
}

function buildCatalogFilter(
  options: ScopedEntityPickerUiOptions,
): EntityFilterQuery | undefined {
  const catalogFilter = options.catalogFilter;
  if (!catalogFilter) {
    return undefined;
  }
  return Array.isArray(catalogFilter)
    ? catalogFilter.map(toQuery)
    : toQuery(catalogFilter);
}

/**
 * A scaffolder EntityPicker variant that additionally restricts the candidate
 * entities to those belonging to the tenant/environment selected in a sibling
 * form field. This prevents users from linking a Vault use-case to a parent
 * workspace that lives in a different tenant project.
 */
export function ScopedEntityPicker(
  props: FieldExtensionComponentProps<string, ScopedEntityPickerUiOptions>,
) {
  const {
    onChange,
    formData,
    required,
    rawErrors,
    idSchema,
    formContext,
    schema: { title = 'Entity', description = 'Select an entity' },
    uiSchema,
  } = props;

  const options = uiSchema['ui:options'] ?? {};
  const catalogApi = useApi(catalogApiRef);
  const filter = buildCatalogFilter(options);

  const scopeField = options.scopeField;
  const scopeAnnotation = options.scopeAnnotation ?? 'hcptf.io/target';
  const scopeRef = scopeField
    ? ((formContext?.formData as Record<string, unknown> | undefined)?.[
        scopeField
      ] as string | undefined)
    : undefined;
  const scopeName = useMemo(() => {
    if (!scopeRef) {
      return undefined;
    }
    try {
      return parseEntityRef(scopeRef).name;
    } catch {
      return scopeRef;
    }
  }, [scopeRef]);

  const { value: entities, loading } = useAsync(async () => {
    const { items } = await catalogApi.getEntities({
      filter,
      fields: [
        'kind',
        'metadata.name',
        'metadata.namespace',
        'metadata.title',
        'metadata.annotations',
      ],
    });
    return items;
  }, [catalogApi, JSON.stringify(filter)]);

  const scoped = useMemo(() => {
    const items = entities ?? [];
    if (!scopeName) {
      return items;
    }
    const wanted = scopeName.toLowerCase();
    return items.filter(
      (entity: Entity) =>
        (entity.metadata.annotations?.[scopeAnnotation] ?? '').toLowerCase() ===
        wanted,
    );
  }, [entities, scopeName, scopeAnnotation]);

  const entityRefs = useMemo(
    () => scoped.map(entity => stringifyEntityRef(entity)),
    [scoped],
  );

  const labelFor = (ref: string): string => {
    const entity = scoped.find(candidate => stringifyEntityRef(candidate) === ref);
    return entity?.metadata.title ?? ref;
  };

  let helperText = description;
  if (scopeField && !scopeName) {
    helperText =
      'Select the tenant / environment first to list matching workspaces.';
  } else if (scopeName && !loading && scoped.length === 0) {
    helperText = `No matching workspaces found in "${scopeName}".`;
  }

  return (
    <ScaffolderField
      rawErrors={rawErrors}
      rawDescription={helperText}
      required={required}
    >
      <Autocomplete
        id={idSchema?.$id}
        value={formData || null}
        options={entityRefs}
        getOptionLabel={option => labelFor(option)}
        loading={loading}
        onChange={(_event, value) => onChange(value ?? undefined)}
        renderInput={params => (
          <TextField
            {...params}
            label={title}
            required={required}
            margin="dense"
            variant="outlined"
          />
        )}
      />
    </ScaffolderField>
  );
}
