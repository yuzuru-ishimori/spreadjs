// DD-024 単独モード options 検証（fail-fast・AC6）の unit。

import { describe, expect, it } from 'vitest';

import { validateStandaloneOptions } from './standalone-options';

describe('validateStandaloneOptions: fail-fast（AC6・contract §4）', () => {
  it('正常な単独 options は undefined（合格）', () => {
    expect(validateStandaloneOptions({ mode: 'standalone', columnOrder: ['col-a'] })).toBeUndefined();
  });

  it('serverUrl 混在は standalone-options-conflict', () => {
    expect(
      validateStandaloneOptions({ mode: 'standalone', columnOrder: ['col-a'], serverUrl: 'http://x' }),
    ).toBe('standalone-options-conflict');
  });

  it('displayName 混在は standalone-options-conflict', () => {
    expect(
      validateStandaloneOptions({ mode: 'standalone', columnOrder: ['col-a'], displayName: 'me' }),
    ).toBe('standalone-options-conflict');
  });

  it('clientId 混在は standalone-options-conflict', () => {
    expect(validateStandaloneOptions({ mode: 'standalone', columnOrder: ['col-a'], clientId: 'c1' })).toBe(
      'standalone-options-conflict',
    );
  });

  it('columnOrder 未指定は standalone-options-invalid', () => {
    expect(validateStandaloneOptions({ mode: 'standalone' })).toBe('standalone-options-invalid');
  });

  it('columnOrder 空配列は standalone-options-invalid', () => {
    expect(validateStandaloneOptions({ mode: 'standalone', columnOrder: [] })).toBe('standalone-options-invalid');
  });

  it('columnOrder 非配列は standalone-options-invalid', () => {
    expect(validateStandaloneOptions({ mode: 'standalone', columnOrder: 'col-a' })).toBe(
      'standalone-options-invalid',
    );
  });

  it('conflict 検査を invalid より優先する（server 混在は列順より先に弾く）', () => {
    expect(validateStandaloneOptions({ mode: 'standalone', serverUrl: 'http://x' })).toBe(
      'standalone-options-conflict',
    );
  });
});
