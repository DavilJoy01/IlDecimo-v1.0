// mobile/src/utils/dateTimeInput.test.ts
import { formatDateInput, parseDateInput, formatTimeInput, parseTimeInput } from './dateTimeInput';

describe('dateTimeInput', () => {
  describe('formatDateInput / parseDateInput', () => {
    it('formats a Date into YYYY-MM-DD using local getters', () => {
      expect(formatDateInput(new Date(2026, 2, 5))).toBe('2026-03-05');
    });

    it('pads single-digit month and day', () => {
      expect(formatDateInput(new Date(2026, 0, 9))).toBe('2026-01-09');
    });

    it('parses YYYY-MM-DD back into the same local-time Date', () => {
      const parsed = parseDateInput('2026-03-05');
      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(2);
      expect(parsed.getDate()).toBe(5);
    });

    it('round-trips through format then parse', () => {
      const original = new Date(2026, 8, 30);
      expect(formatDateInput(parseDateInput(formatDateInput(original)))).toBe(formatDateInput(original));
    });

    it('falls back to a fixed date for invalid input', () => {
      const parsed = parseDateInput('not-a-date');
      expect(formatDateInput(parsed)).toBe('2000-01-01');
    });
  });

  describe('formatTimeInput / parseTimeInput', () => {
    it('formats a Date into HH:MM using local getters', () => {
      expect(formatTimeInput(new Date(2026, 2, 5, 9, 5))).toBe('09:05');
    });

    it('pads single-digit hours and minutes', () => {
      expect(formatTimeInput(new Date(2026, 2, 5, 0, 0))).toBe('00:00');
    });

    it('parses HH:MM onto the fallback date, preserving its day', () => {
      const fallback = new Date(2026, 2, 5, 12, 0);
      const parsed = parseTimeInput('18:30', fallback);
      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(2);
      expect(parsed.getDate()).toBe(5);
      expect(parsed.getHours()).toBe(18);
      expect(parsed.getMinutes()).toBe(30);
    });

    it('returns the fallback unchanged for invalid input', () => {
      const fallback = new Date(2026, 2, 5, 12, 0);
      expect(parseTimeInput('nope', fallback)).toBe(fallback);
    });

    it('round-trips through format then parse', () => {
      const fallback = new Date(2026, 2, 5, 0, 0);
      expect(formatTimeInput(parseTimeInput('21:45', fallback))).toBe('21:45');
    });
  });
});
