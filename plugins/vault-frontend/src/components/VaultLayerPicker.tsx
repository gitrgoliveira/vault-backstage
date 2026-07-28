import type { Entity } from '@backstage/catalog-model';
import {
  EntityAutocompletePicker,
  type DefaultEntityFilters,
  type EntityFilter,
} from '@backstage/plugin-catalog-react';

const LAYER_ANNOTATION = 'hcptf.io/layer';

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
