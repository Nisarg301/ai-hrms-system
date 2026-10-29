import { Alert, Card, Empty, Select, Skeleton, Tag, theme } from 'antd';
import dayjs from 'dayjs';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../../hooks/store';
import { selectHolidays, selectHolidaysError, selectHolidaysStatus } from '../../../store/holidays/holidaysSelectors';
import { fetchHolidays } from '../../../store/holidays/holidaysThunks';
import type { Holiday } from '../../../types/holiday';

/** Holidays grouped by month ("January 2026"), in date order. */
export function groupByMonth(holidays: Holiday[]): { month: string; items: Holiday[] }[] {
  const groups = new Map<string, Holiday[]>();
  for (const h of [...holidays].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = h.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), h]);
  }
  return [...groups.entries()].map(([key, items]) => ({ month: dayjs(`${key}-01`).format('MMMM YYYY'), items }));
}

/** The holiday calendar for a year. The year is in the URL (?year=2027), so the Holidays assistant's answers can move it. */
export function HolidaysTab() {
  const dispatch = useAppDispatch();
  const { token } = theme.useToken();
  const holidays = useAppSelector(selectHolidays);
  const status = useAppSelector(selectHolidaysStatus);
  const error = useAppSelector(selectHolidaysError);
  const thisYear = dayjs().year();
  const [params, setParams] = useSearchParams();
  const asked = Number(params.get('year'));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : thisYear;
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, year])].sort();
  const setYear = (y: number) =>
    setParams(
      (p) => {
        if (y === thisYear) p.delete('year');
        else p.set('year', String(y));
        return p;
      },
      { replace: true }
    );
  const today = dayjs().format('YYYY-MM-DD');

  useEffect(() => {
    void dispatch(fetchHolidays(year));
  }, [dispatch, year]);

  const groups = groupByMonth(holidays);
  const nextId = holidays.find((h) => h.date >= today)?.id;

  return (
    <Card
      title="Holiday calendar"
      extra={
        <Select
          aria-label="Year"
          value={year}
          onChange={setYear}
          options={years.map((y) => ({ value: y, label: String(y) }))}
        />
      }
    >
      {error ? (
        <Alert type="error" showIcon message={error} />
      ) : status !== 'succeeded' ? (
        <Skeleton active />
      ) : groups.length === 0 ? (
        <Empty description={`No holidays have been added for ${year} yet.`} />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.month} aria-label={g.month}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide" style={{ color: token.colorPrimary }}>
                {g.month}
              </h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {g.items.map((h) => {
                  const past = h.date < today;
                  return (
                    <li
                      key={h.id}
                      data-testid="holiday-row"
                      data-past={past}
                      className="flex items-center gap-4 rounded-lg p-3"
                      style={{ background: token.colorFillQuaternary, opacity: past ? 0.5 : 1 }}
                    >
                      <div className="w-24 shrink-0 font-medium">{dayjs(h.date).format('ddd, DD MMM')}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{h.name}</div>
                        {h.description ? (
                          <div className="text-xs" style={{ color: token.colorTextSecondary }}>
                            {h.description}
                          </div>
                        ) : null}
                      </div>
                      {h.id === nextId ? <Tag color="blue">Next</Tag> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
