'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Click-to-sort for every list table in the CRM that doesn't already have it. Mounted once (via
// ViewModeToggle) and works on whatever <table>s a page renders inside <main data-view-root>, so no
// per-page wiring. Tables whose headers are already sortable (SortableTh / DataTable use
// `cursor-pointer`) are left alone. Sorting reorders the rows currently on the page (same as the
// existing per-page sorting); it is re-applied when rows reload. Opt a table out with data-no-sort.
type Dir = 'asc' | 'desc';
interface SortState { col: number; dir: Dir }

const root = () => document.querySelector<HTMLElement>('main[data-view-root]');
const states = new WeakMap<HTMLTableElement, SortState>();

const MONTHS = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

function toValue(text: string): { n: number | null; s: string } {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t === '-' || t === '—' || t === 'N/A') return { n: null, s: '' };
  // dd/mm/yyyy [hh:mm]
  const dmy = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (dmy) return { n: Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1], +(dmy[4] || 0), +(dmy[5] || 0)), s: t };
  if (/^\d{4}-\d{2}-\d{2}/.test(t) || (MONTHS.test(t) && /\d{4}/.test(t))) {
    const d = Date.parse(t);
    if (!Number.isNaN(d)) return { n: d, s: t };
  }
  // numbers, optionally with a currency prefix / unit suffix: "AED 1,200.50", "45%"
  const num = t.match(/^[^\d-]{0,6}(-?[\d,]*\.?\d+)\s*[A-Za-z%]{0,4}$/);
  if (num) {
    const v = Number(num[1].replace(/,/g, ''));
    if (Number.isFinite(v)) return { n: v, s: t };
  }
  return { n: null, s: t.toLowerCase() };
}

function compare(a: string, b: string): number {
  const x = toValue(a);
  const y = toValue(b);
  if (!x.s && !y.s) return 0;
  if (!x.s) return 1; // blanks always last
  if (!y.s) return -1;
  if (x.n !== null && y.n !== null) return x.n - y.n;
  return x.s.localeCompare(y.s, undefined, { numeric: true, sensitivity: 'base' });
}

// Returns the table's sortable rows, or null when the table has a layout we shouldn't reorder
// (expandable detail rows, merged cells...). A lone full-width row (empty state) is fine.
function sortableRows(table: HTMLTableElement, cols: number): HTMLTableRowElement[] | null {
  const body = table.tBodies[0];
  if (!body) return null;
  const rows = Array.from(body.rows);
  const good = rows.filter((r) => r.cells.length === cols && !Array.from(r.cells).some((c) => c.hasAttribute('colspan')));
  if (good.length < 2) return null;
  if (good.length !== rows.length) return null;
  return good;
}

function applySort(table: HTMLTableElement) {
  const st = states.get(table);
  const head = table.tHead?.rows[0];
  if (!st || !head) return;
  const rows = sortableRows(table, head.cells.length);
  if (!rows) return;
  const keyed = rows.map((row, i) => ({ row, i, text: row.cells[st.col]?.textContent || '' }));
  keyed.sort((p, q) => {
    const c = compare(p.text, q.text);
    return c !== 0 ? (st.dir === 'asc' ? c : -c) : p.i - q.i;
  });
  const body = table.tBodies[0];
  const changed = keyed.some((k, i) => k.row !== rows[i]);
  if (changed) keyed.forEach((k) => body.appendChild(k.row));
}

function decorate(table: HTMLTableElement) {
  const head = table.tHead?.rows[0];
  if (!head || table.tHead!.rows.length !== 1) return;
  const st = states.get(table);
  Array.from(head.cells).forEach((th, i) => {
    const text = (th.textContent || '').trim();
    const alreadySortable = th.className.includes('cursor-pointer') || th.querySelector('[class*="cursor-pointer"]');
    if (!text || alreadySortable || th.hasAttribute('colspan')) {
      if (th.hasAttribute('data-sortable')) { th.removeAttribute('data-sortable'); th.removeAttribute('data-sort-dir'); }
      return;
    }
    if (th.getAttribute('data-sortable') !== '1') th.setAttribute('data-sortable', '1');
    const dir = st && st.col === i ? st.dir : '';
    if ((th.getAttribute('data-sort-dir') || '') !== dir) {
      if (dir) th.setAttribute('data-sort-dir', dir); else th.removeAttribute('data-sort-dir');
    }
  });
}

export default function TableSorting() {
  const pathname = usePathname();

  useEffect(() => {
    const main = root();
    if (!main) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;

    const refresh = () => {
      busy = true;
      main.querySelectorAll<HTMLTableElement>('table:not([data-no-sort])').forEach((table) => {
        decorate(table);
        if (states.has(table)) applySort(table);
      });
      // Let our own DOM changes settle before observing again.
      setTimeout(() => { busy = false; }, 0);
    };
    const schedule = () => {
      if (busy) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 100);
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input, select, textarea, label')) return;
      const th = target.closest('th[data-sortable="1"]') as HTMLTableCellElement | null;
      if (!th) return;
      const table = th.closest('table') as HTMLTableElement | null;
      if (!table || table.hasAttribute('data-no-sort')) return;
      const col = (th.parentElement as HTMLTableRowElement).cells ? Array.from((th.parentElement as HTMLTableRowElement).cells).indexOf(th) : -1;
      if (col < 0) return;
      const prev = states.get(table);
      states.set(table, { col, dir: prev && prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc' });
      refresh();
    };

    refresh();
    const observer = new MutationObserver(schedule);
    observer.observe(main, { childList: true, subtree: true });
    main.addEventListener('click', onClick);
    return () => {
      observer.disconnect();
      main.removeEventListener('click', onClick);
      clearTimeout(timer);
    };
  }, [pathname]);

  return null;
}
