import type { Entity } from '@backstage/catalog-model';
import {
  EntityAutocompletePicker,
  type DefaultEntityFilters,
  type EntityFilter,
} from '@backstage/plugin-catalog-react';

// Annotation set on every ingested vault-workspace Resource, recording the
// architecture layer it was provisioned into. Each layer corresponds 1:1 to a
// `/create` template card: trust -> L1, workload -> L2, usecase -> L3.
const LAYER_ANNOTATION = 'hcptf.io/layer';

/**
 * Catalog list filter that narrows entities by their `hcptf.io/layer`
 * annotation, i.e. the `/create` card the workspace was provisioned from.
 */
export class VaultLayerFilter implements EntityFilter {
  constructor(readonly values: string[]) {}

  getCatalogFilters(): Record<string, string[]> {
    return { [`metadata.annotations.${LAYER_ANNOTATION}`]: this.values };
  }

  filterEntity(entity: Entity): boolean {
    const layer = entity.metadata.annotations?.[LAYER_ANNOTATION];
    return layer !== undefined && this.values.includes(layer);
  }

  toQueryValue(): string[] {
    return this.values;
  }
}

type VaultLayerEntityFilters = DefaultEntityFilters & {
  vaultLayer?: VaultLayerFilter;
};

/**
 * Sidebar filter for the catalog list page that lets users filter workspaces by
 * their layer (trust / workload / usecase). Available options are sourced from
 * the current kind/type facet, so the picker only appears when the listed
 * entities actually carry the `hcptf.io/layer` annotation.
 */
export function VaultLayerPicker() {
  return (
    <EntityAutocompletePicker<VaultLayerEntityFilters, 'vaultLayer'>
      label="Layer"
      name="vaultLayer"
      path={`metadata.annotations.${LAYER_ANNOTATION}`}
      Filter={VaultLayerFilter}
      filtersForAvailableValues={['kind', 'type']}
      showCounts
    />
  );
}
