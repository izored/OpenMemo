import { describe, expect, it } from 'vitest';
import { formatBytes } from './utils';

const MB = 1024 * 1024;

describe('formatBytes', () => {
  it('says what the three measured cases would say on the switch', () => {
    // The numbers this exists to print, from real links on 2026-09-09.
    expect(formatBytes(6 * MB)).toBe('6 MB');
    expect(formatBytes(509 * MB)).toBe('509 MB');
    expect(formatBytes(36887)).toBe('under 1 MB');
  });

  it('does not imply precision a prediction does not have', () => {
    // 6.3 MB reads as measured. It is not.
    expect(formatBytes(6.3 * MB)).toBe('6 MB');
    expect(formatBytes(6.7 * MB)).toBe('7 MB');
  });

  it('switches to gigabytes rather than printing four digits', () => {
    expect(formatBytes(2048 * MB)).toBe('2.0 GB');
    expect(formatBytes(1536 * MB)).toBe('1.5 GB');
  });

  it('handles nothing at all', () => {
    expect(formatBytes(0)).toBe('under 1 MB');
  });
});
