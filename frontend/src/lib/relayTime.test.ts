import { describe, expect, it } from 'vitest';
import { relayTimeLeft } from './relayTime';

describe('relayTimeLeft', () => {
  it('reports a twelve-hour session in hours, not zero days', () => {
    // The bug: the relay grants half a day, whole days floor to 0, and a
    // freshly verified session said "0 days left".
    expect(relayTimeLeft(12 * 3600)).toBe('12 hours left');
    expect(relayTimeLeft(12 * 3600 - 60)).toBe('11 hours left');
  });

  it('uses days once there is more than a day', () => {
    expect(relayTimeLeft(30 * 86400)).toBe('30 days left');
    expect(relayTimeLeft(86400)).toBe('1 day left');
  });

  it('drops to minutes in the last hour', () => {
    expect(relayTimeLeft(3599)).toBe('59 minutes left');
    expect(relayTimeLeft(90)).toBe('1 minute left');
  });

  it('never counts down past zero', () => {
    // 30 seconds is still time left, so it rounds up rather than saying zero.
    expect(relayTimeLeft(30)).toBe('1 minute left');
    expect(relayTimeLeft(0)).toBe('');
    expect(relayTimeLeft(-5)).toBe('');
  });

  it('says nothing when there is no session to measure', () => {
    expect(relayTimeLeft(null)).toBe('');
    expect(relayTimeLeft(undefined)).toBe('');
  });
});
