import { toTfVars } from './provision';

describe('toTfVars', () => {
  it('sends scalar template values as strings, with booleans and numbers as HCL', () => {
    // A checkbox rendered by `${{ parameters.capabilityRead }}` arrives as a
    // real boolean, not the string "true".
    expect(
      toTfVars({
        capability_read: true,
        capability_sudo: false,
        ttl: 3600,
        name: 'payments',
      }),
    ).toEqual([
      {
        key: 'capability_read',
        value: 'true',
        category: 'terraform',
        hcl: true,
        sensitive: false,
      },
      {
        key: 'capability_sudo',
        value: 'false',
        category: 'terraform',
        hcl: true,
        sensitive: false,
      },
      {
        key: 'ttl',
        value: '3600',
        category: 'terraform',
        hcl: true,
        sensitive: false,
      },
      {
        key: 'name',
        value: 'payments',
        category: 'terraform',
        hcl: false,
        sensitive: false,
      },
    ]);
  });

  it('marks keys listed in sensitiveVars as sensitive', () => {
    expect(
      toTfVars({ db_url: 'example-value' }, { db_url: true })[0].sensitive,
    ).toBe(true);
  });
});
