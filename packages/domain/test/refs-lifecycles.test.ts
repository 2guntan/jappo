import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  allowedActions,
  blockMachine,
  canTransition,
  canonicalJson,
  formatRef,
  isWorkingDay,
  rfpMachine,
  senegalFixedHolidays,
  settlementMachine,
  transition,
  TransitionError,
} from '../src';

describe('refs and working days', () => {
  it('formats refs', () => expect(formatRef('BLK', 2026, 1)).toBe('BLK-2026-0001'));
  it('adds 15 working days skipping weekends and holidays', () => {
    const start = new Date('2026-12-21T10:00:00Z'); // Monday
    const hol = senegalFixedHolidays(2026).concat(senegalFixedHolidays(2027)).map((h) => h.date);
    const d = addWorkingDays(start, 15, hol);
    // Skips 25 Dec 2026 and 1 Jan 2027 → Wed 13 Jan 2027
    expect(d.toISOString()).toBe('2027-01-13T10:00:00.000Z');
    expect(isWorkingDay(new Date('2026-12-25T00:00:00Z'), hol)).toBe(false);
    expect(isWorkingDay(new Date('2026-12-26T00:00:00Z'), hol)).toBe(false);
    expect(isWorkingDay(new Date('2026-12-28T00:00:00Z'), hol)).toBe(true);
  });
});

describe('lifecycles', () => {
  it('applies allowed transitions', () => {
    expect(transition(rfpMachine, 'draft', 'open')).toBe('open');
    expect(transition(blockMachine, 'ready', 'archive')).toBe('archived');
    expect(canTransition(rfpMachine, 'awarded', 'cancel')).toBe(false);
    expect(() => transition(settlementMachine, 'draft', 'reconcile')).toThrow(TransitionError);
    expect(allowedActions(rfpMachine, 'open').sort()).toEqual(['cancel', 'close', 'close_early', 'extend']);
  });
});

describe('canonicalJson', () => {
  it('sorts keys and normalises values', () => {
    expect(canonicalJson({ b: 1, a: { d: 2n, c: [new Date(0), undefined] } })).toBe(
      '{"a":{"c":["1970-01-01T00:00:00.000Z",null],"d":"2"},"b":1}',
    );
    expect(canonicalJson({ x: undefined, y: null })).toBe('{"y":null}');
  });
});
