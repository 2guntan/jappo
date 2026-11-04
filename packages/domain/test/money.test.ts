import { describe, expect, it } from 'vitest';
import { formatXof, roundRatio, roundXof, splitProRata, floorXof } from '../src';

describe('money', () => {
  it('rounds half to even', () => {
    expect(roundXof('0.5')).toBe(0);
    expect(roundXof('1.5')).toBe(2);
    expect(roundXof('2.5')).toBe(2);
    expect(roundXof('332142.86')).toBe(332143);
    expect(roundRatio('1.845')).toBe(1.84);
    expect(roundRatio('1.835')).toBe(1.84);
    expect(floorXof('9.99')).toBe(9);
  });

  it('splits with floor + largest fractional remainder (SPEC §9.6.4 example)', () => {
    const r = splitProRata(122000, [
      { key: 'F1', weight: 1542000 },
      { key: 'F2', weight: 760000 },
    ]);
    expect(r.get('F1')).toBe(81722);
    expect(r.get('F2')).toBe(40278);
  });

  it('respects caps and ties by key', () => {
    const r = splitProRata(10, [
      { key: 'b', weight: 1 },
      { key: 'a', weight: 1 },
      { key: 'c', weight: 1, cap: 2 },
    ]);
    expect(r.get('c')).toBe(2);
    expect((r.get('a') ?? 0) + (r.get('b') ?? 0)).toBe(8);
    expect(r.get('a')).toBe(4);
    const tie = splitProRata(1, [
      { key: 'b', weight: 1 },
      { key: 'a', weight: 1 },
    ]);
    expect(tie.get('a')).toBe(1);
    expect(tie.get('b')).toBe(0);
  });

  it('handles empty and zero weights', () => {
    expect(splitProRata(5, []).size).toBe(0);
    expect(splitProRata(5, [{ key: 'a', weight: 0 }]).get('a')).toBe(0);
    const allCapped = splitProRata(10, [{ key: 'a', weight: 1, cap: 3 }]);
    expect(allCapped.get('a')).toBe(3);
  });

  it('formats XOF fr-SN', () => {
    expect(formatXof(1308000)).toBe('1 308 000 FCFA');
    expect(formatXof(-5n)).toBe('-5 FCFA');
  });
});
