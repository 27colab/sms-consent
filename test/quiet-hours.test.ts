import { describe, expect, it } from 'vitest';
import { isQuietHour, localMinutes, nextAllowedTime } from '../src/index.js';

const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

describe('quiet hours', () => {
  it('computes local minutes in a zone', () => {
    expect(localMinutes(new Date('2030-06-01T16:30:00Z'), NY)).toBe(12 * 60 + 30); // EDT = UTC-4
    expect(localMinutes(new Date('2030-01-01T16:30:00Z'), NY)).toBe(11 * 60 + 30); // EST = UTC-5
    expect(localMinutes(new Date('2030-01-01T00:05:00Z'), TOKYO)).toBe(9 * 60 + 5);
  });

  it.each([
    ['2030-06-02T01:00:00Z', true], // 21:00 local: start inclusive
    ['2030-06-02T00:59:00Z', false], // 20:59
    ['2030-06-02T03:00:00Z', true], // 23:00
    ['2030-06-02T06:00:00Z', true], // 02:00
    ['2030-06-02T11:59:00Z', true], // 07:59
    ['2030-06-02T12:00:00Z', false], // 08:00
  ])('default window at %s -> %s', (iso, quiet) => {
    expect(isQuietHour(new Date(iso), NY)).toBe(quiet);
  });

  it('depends on the recipient zone, not the server zone', () => {
    const at = new Date('2030-06-01T23:00:00Z'); // 19:00 NY (ok), 08:00 next day Tokyo (ok), 04:00 Honolulu? no: 13:00
    expect(isQuietHour(at, NY)).toBe(false);
    expect(isQuietHour(new Date('2030-06-01T15:00:00Z'), TOKYO)).toBe(true); // 00:00 Tokyo
  });

  it('supports custom and non-wrapping windows', () => {
    const noon = new Date('2030-06-01T16:00:00Z'); // 12:00 NY
    expect(isQuietHour(noon, NY, { start: '12:00', end: '13:00' })).toBe(true);
    expect(isQuietHour(noon, NY, { start: '13:00', end: '14:00' })).toBe(false);
    expect(isQuietHour(noon, NY, { start: '09:00', end: '09:00' })).toBe(false);
  });

  it('handles DST transitions', () => {
    // 2030-03-10 is spring-forward in the US. 06:30Z = 01:30 EST; 07:30Z = 03:30 EDT.
    expect(localMinutes(new Date('2030-03-10T06:30:00Z'), NY)).toBe(90);
    expect(localMinutes(new Date('2030-03-10T07:30:00Z'), NY)).toBe(210);
  });

  it('rejects malformed times and unknown zones', () => {
    expect(() => isQuietHour(new Date(), NY, { start: '9pm' })).toThrow(/HH:MM/);
    expect(() => isQuietHour(new Date(), NY, { start: '25:00' })).toThrow(/HH:MM/);
    expect(() => isQuietHour(new Date(), 'Not/AZone')).toThrow(RangeError);
  });

  it('finds the next allowed time', () => {
    const at = new Date('2030-06-02T03:00:07Z'); // 23:00:07 NY
    expect(nextAllowedTime(at, NY).toISOString()).toBe('2030-06-02T12:00:00.000Z'); // 08:00 NY
    const ok = new Date('2030-06-01T16:00:00Z');
    expect(nextAllowedTime(ok, NY).toISOString()).toBe(ok.toISOString());
  });
});
