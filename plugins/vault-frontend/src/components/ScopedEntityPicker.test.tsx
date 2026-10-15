import { isStaleSelection } from './ScopedEntityPicker';

describe('isStaleSelection', () => {
  const candidates = ['resource:default/trust-c1', 'resource:default/trust-c2'];

  it('keeps a value that is one of the candidates', () => {
    expect(isStaleSelection('resource:default/trust-c1', candidates)).toBe(
      false,
    );
  });

  it('flags a value the filtered candidates do not contain', () => {
    expect(isStaleSelection('resource:default/tenants', candidates)).toBe(true);
  });

  it('never flags while candidates are unknown or nothing is selected', () => {
    expect(isStaleSelection('resource:default/tenants', undefined)).toBe(false);
    expect(isStaleSelection('', candidates)).toBe(false);
    expect(isStaleSelection(undefined, candidates)).toBe(false);
  });
});
