import type { Entity } from '@backstage/catalog-model';
import { VaultLayerFilter } from './VaultLayerPicker';

const entity = (annotations?: Record<string, string>): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: { name: 'ws', annotations },
});

describe('VaultLayerFilter', () => {
  it('builds the server-side filter on the hcptf.io/layer annotation', () => {
    expect(new VaultLayerFilter(['workload']).getCatalogFilters()).toEqual({
      'metadata.annotations.hcptf.io/layer': ['workload'],
    });
  });

  it('matches entities whose layer is one of the selected values', () => {
    const filter = new VaultLayerFilter(['trust', 'workload']);
    expect(filter.filterEntity(entity({ 'hcptf.io/layer': 'workload' }))).toBe(
      true,
    );
    expect(filter.filterEntity(entity({ 'hcptf.io/layer': 'usecase' }))).toBe(
      false,
    );
  });

  it('rejects entities without the annotation', () => {
    const filter = new VaultLayerFilter(['workload']);
    expect(filter.filterEntity(entity())).toBe(false);
    expect(filter.filterEntity(entity({ other: 'workload' }))).toBe(false);
  });

  it('serialises the selected values for the query string', () => {
    expect(new VaultLayerFilter(['trust', 'usecase']).toQueryValue()).toEqual([
      'trust',
      'usecase',
    ]);
  });
});
