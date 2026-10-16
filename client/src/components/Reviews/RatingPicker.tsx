import { Radio, theme } from 'antd';
import { RATING_LABELS } from '../../utils/performanceFormat';

/** 1–5, each with its label (the label of the chosen one is shown below). */
export function RatingPicker({ id, value, onChange }: { id: string; value: number | null; onChange: (rating: number) => void }) {
  const { token } = theme.useToken();
  return (
    <div>
      <Radio.Group id={id} optionType="button" buttonStyle="solid" value={value ?? undefined} onChange={(e) => onChange(e.target.value)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Radio.Button key={n} value={n} aria-label={`${n}: ${RATING_LABELS[n]}`} title={RATING_LABELS[n]}>
            {n}
          </Radio.Button>
        ))}
      </Radio.Group>
      <div className="mt-1 text-sm" style={{ color: token.colorTextSecondary }}>
        {value ? `${value} · ${RATING_LABELS[value]}` : 'Choose a rating'}
      </div>
    </div>
  );
}
