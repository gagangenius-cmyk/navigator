'use client';

import { useCallback, useEffect, useState } from 'react';
import { LayoutGrid, List, Rows3 } from 'lucide-react';

// One List / Card switch for every CRM page. It sets data-view on <main data-view-root>; globals.css restyles
// whatever the page renders: <table>s become cards, RecordCards become compact rows. "Default" leaves each
// page as designed. The choice is remembered in this browser.
type Mode = '' | 'list' | 'card';
const KEY = 'crm-view-mode';

const root = () => document.querySelector<HTMLElement>('main[data-view-root]');

// Card mode shows each cell with its column heading; copy the heading text onto the cells.
function labelCells() {
  root()?.querySelectorAll<HTMLTableElement>('table:not([data-no-card])').forEach((table) => {
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim());
    if (headers.length === 0) return;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((cell, i) => {
        const label = headers[i] ?? '';
        if (cell.tagName === 'TD' && !cell.hasAttribute('colspan') && cell.getAttribute('data-label') !== label) {
          cell.setAttribute('data-label', label);
        }
      });
    });
  });
}

export default function ViewModeToggle() {
  const [mode, setMode] = useState<Mode>('');

  const apply = useCallback((next: Mode) => {
    const el = root();
    if (el) el.setAttribute('data-view', next);
    if (next === 'card') labelCells();
  }, []);

  useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Mode) || '';
    // Browser-only preference, readable after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(saved);
  }, []);

  useEffect(() => {
    apply(mode);
    const el = root();
    if (!el || mode !== 'card') return;
    // Pages load their rows asynchronously: label new rows as they appear.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(labelCells, 80);
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [mode, apply]);

  const choose = (next: Mode) => {
    setMode(next);
    localStorage.setItem(KEY, next);
  };

  const options: Array<{ id: Mode; label: string; icon: typeof List }> = [
    { id: '', label: 'Default', icon: Rows3 },
    { id: 'list', label: 'List', icon: List },
    { id: 'card', label: 'Cards', icon: LayoutGrid },
  ];

  return (
    <div className="mb-3 flex items-center justify-end gap-1" aria-label="View mode">
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => choose(id)}
          title={`${label} view`}
          className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${mode === id ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
