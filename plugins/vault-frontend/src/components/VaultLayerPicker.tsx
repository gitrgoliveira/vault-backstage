import type { Entity } from '@backstage/catalog-model';
import {
  EntityAutocompletePicker,
  type DefaultEntityFilters,
  type EntityFilter,
} from '@backstage/plugin-catalog-react';
import { LAYER_ANNOTATION } from './layer';

/**
 * Catalog list filter that narrows entities by their `hcptf.io/layer`
 * annotation. Applies to any entity carrying it: vault-workspace Resources
 * (the `/create` card they were provisioned from: trust -> L1, workload -> L2,
 * usecase -> L3) and the terraform-module Components in catalog/modules.yaml.
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
 * Sidebar filter for the catalog list page that lets users filter vault
 * workspaces or modules by layer (trust / workload / usecase). Available
 * options are sourced from the current kind/type facet, so the picker only
 * appears when the listed entities actually carry the `hcptf.io/layer`
 * annotation.
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
