import { formatDay, resolveDate } from '../../src/ai/dates';

describe('resolveDate', () => {
  const tuesday = '2026-10-13';

  it.each([
    ['next Monday', '2026-10-19'],
    ['tomorrow', '2026-10-14'],
    ['today', '2026-10-13'],
    ['2 Nov', '2026-11-02'],
    ['1st November', '2026-11-01'],
    ['15 Aug 1995', '1995-08-15'],
    ['15/08/1995', '1995-08-15'],
    ['2026-10-19', '2026-10-19'],
  ])('%s -> %s', (said, iso) => {
    expect(resolveDate(said, tuesday)).toBe(iso);
  });

  it('counts an end date from the start date', () => {
    expect(resolveDate('Tuesday', '2026-10-19')).toBe('2026-10-20');
  });

  it('returns null when there is no date, or an impossible one', () => {
    expect(resolveDate('whenever', tuesday)).toBeNull();
    expect(resolveDate('2026-02-30', tuesday)).toBeNull();
  });
});

describe('formatDay', () => {
  it('shows the weekday', () => {
    expect(formatDay('2026-10-15')).toBe('Thu 15 Oct 2026');
  });
});
