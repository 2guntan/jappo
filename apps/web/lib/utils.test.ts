import { describe, expect, it } from 'vitest';
import { cn, formatXof, kycTone } from './utils';

describe('web utils', () => {
  it('formats XOF in fr-SN', () => {
    expect(formatXof(1308000).replace(/\s/g, ' ')).toBe('1 308 000 FCFA');
    expect(formatXof(null)).toBe('—');
  });
  it('merges classes and maps KYC tones', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(kycTone('verified')).toBe('green');
    expect(kycTone('rejected')).toBe('red');
  });
});
