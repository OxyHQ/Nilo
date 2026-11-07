import { describe, expect, it } from 'vitest';
import { acceptsFilterOperator, verificationState } from '@oxy.so/nilo-contracts';

describe('verificationState', () => {
  const now = new Date('2026-11-07T12:00:00Z');

  it('is unverified without a verification, or once it was removed', () => {
    expect(verificationState(undefined, now)).toBe('unverified');
    expect(verificationState({}, now)).toBe('unverified');
    expect(verificationState({ state: 'unverified' }, now)).toBe('unverified');
  });

  it('is verified until removed, or until its expiry', () => {
    expect(verificationState({ state: 'verified', expiresAt: null }, now)).toBe('verified');
    expect(verificationState({ state: 'verified', expiresAt: '2026-11-08T00:00:00Z' }, now)).toBe(
      'verified',
    );
  });

  it('is expired from the instant of its expiry', () => {
    expect(verificationState({ state: 'verified', expiresAt: '2026-11-07T12:00:00Z' }, now)).toBe(
      'expired',
    );
  });

  it('takes only the is and is-not operators', () => {
    expect(acceptsFilterOperator('verification', 'is')).toBe(true);
    expect(acceptsFilterOperator('verification', 'is_not')).toBe(true);
    expect(acceptsFilterOperator('verification', 'contains')).toBe(false);
  });
});
