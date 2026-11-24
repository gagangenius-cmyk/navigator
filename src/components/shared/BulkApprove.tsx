'use client';

import { useCallback, useState } from 'react';
import { CheckCircle } from 'lucide-react';

/** Selection state for "approve many at once" lists. */
export function useBulkSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const setAll = useCallback((ids: number[]) => setSelected(new Set(ids)), []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selected, toggle, setAll, clear };
}

export function RowCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="h-5 w-5 cursor-pointer rounded border-gray-300 text-green-600 focus:ring-green-500"
    />
  );
}

/**
 * Bar shown above a list: "select all" checkbox plus an "Approve selected" button.
 * `eligibleIds` are the rows on screen that can be bulk-approved.
 */
export function BulkApproveBar({
  eligibleIds,
  selected,
  onSetAll,
  onClear,
  onApprove,
  busy,
  progress,
  label = 'Approve selected',
}: {
  eligibleIds: number[];
  selected: Set<number>;
  onSetAll: (ids: number[]) => void;
  onClear: () => void;
  onApprove: () => void;
  busy: boolean;
  progress?: string;
  label?: string;
}) {
  if (eligibleIds.length === 0) return null;
  const count = eligibleIds.filter((id) => selected.has(id)).length;
  const allChecked = count === eligibleIds.length;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm">
      <label className="flex cursor-pointer items-center gap-2 font-medium text-green-900">
        <input
          type="checkbox"
          checked={allChecked}
          onChange={() => (allChecked ? onClear() : onSetAll(eligibleIds))}
          disabled={busy}
          className="h-5 w-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
        />
        Select all ({eligibleIds.length})
      </label>
      <span className="text-green-800">{count} selected</span>
      {progress && <span className="text-gray-600">{progress}</span>}
      <button
        type="button"
        onClick={onApprove}
        disabled={busy || count === 0}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        <CheckCircle className="h-4 w-4" /> {busy ? 'Approving…' : `${label} (${count})`}
      </button>
    </div>
  );
}

/**
 * Runs `approveOne` for each id one after another (each call is the same
 * single-item API the per-row button uses, so all server-side checks, audit
 * entries and notifications still apply). Returns per-item failures.
 */
export async function runBulk(
  ids: number[],
  approveOne: (id: number) => Promise<void>,
  onProgress: (done: number, total: number) => void,
): Promise<{ ok: number; failed: Array<{ id: number; error: string }> }> {
  let ok = 0;
  const failed: Array<{ id: number; error: string }> = [];
  for (let i = 0; i < ids.length; i += 1) {
    try {
      await approveOne(ids[i]);
      ok += 1;
    } catch (err) {
      failed.push({ id: ids[i], error: err instanceof Error ? err.message : 'Failed' });
    }
    onProgress(i + 1, ids.length);
  }
  return { ok, failed };
}
