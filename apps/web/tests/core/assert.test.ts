import { describe, expect, it } from 'vitest';
import { EngineError, InvariantError, invariant } from '../../src/core/assert.ts';

describe('assert', () => {
  it('invariant() passes silently when the condition holds', () => {
    expect(() => invariant(true, 'never')).not.toThrow();
    expect(() => invariant(1, 'never')).not.toThrow();
  });

  it('invariant() throws an InvariantError listing the broken rule', () => {
    let caught: unknown;
    try {
      invariant(false, 'I2 amounts are safe integers');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvariantError);
    expect(caught).toBeInstanceOf(Error);
    const err = caught as InvariantError;
    expect(err.broken).toEqual(['I2 amounts are safe integers']);
    expect(err.name).toBe('InvariantError');
    expect(err.message).toContain('I2 amounts are safe integers');
  });

  it('InvariantError keeps every broken invariant', () => {
    const err = new InvariantError(['I1 conservation', 'I9 board length']);
    expect(err.broken).toEqual(['I1 conservation', 'I9 board length']);
    expect(err.message).toBe('Broken invariant: I1 conservation; I9 board length');
  });

  it('EngineError carries a code', () => {
    const err = new EngineError('ILLEGAL_ACTION', 'fold when checking is free');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('ILLEGAL_ACTION');
    expect(err.name).toBe('EngineError');
    expect(err.message).toBe('ILLEGAL_ACTION: fold when checking is free');
    expect(new EngineError('BAD_PHASE').message).toBe('BAD_PHASE');
  });
});
