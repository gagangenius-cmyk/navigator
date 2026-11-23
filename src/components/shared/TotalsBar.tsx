import type { ReactNode } from 'react';

export interface TotalItem { label: string; value: ReactNode; tone?: 'default' | 'good' | 'bad' | 'info' }

const TONE: Record<NonNullable<TotalItem['tone']>, string> = {
  default: 'text-gray-900',
  good: 'text-green-700',
  bad: 'text-red-600',
  info: 'text-blue-700',
};

/**
 * A totals strip for list reports. `title` says what the figures cover
 * ("All 120 matching" vs "This page (25)") so a page-only sum is never mistaken for a grand total.
 */
export default function TotalsBar({ title, items }: { title: string; items: TotalItem[] }) {
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-4 py-3" data-no-columns data-no-sort>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-800">{title}</div>
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-xs font-medium uppercase text-gray-500">{it.label}</div>
            <div className={`text-base font-bold ${TONE[it.tone || 'default']}`}>{it.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
