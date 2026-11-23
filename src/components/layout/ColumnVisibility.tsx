'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Columns3 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

// One "Columns" picker for every list table in the CRM. Like ViewModeToggle it works on whatever <table>s
// the page renders inside <main data-view-root>: no per-page wiring. Hidden columns are applied with a
// generated stylesheet (nth-child rules keyed on a data attribute), so React-owned markup is never edited.
// Choices are saved per logged-in user (server-side, so they follow the person across browsers/devices;
// localStorage keyed by user id is a fast cache) and per page/table, and keyed by column *label* so they survive
// columns being added or reordered. Opt a table out with data-no-columns.
const STORE = 'crm-hidden-columns';
const PREF_KEY = 'hidden-columns';
const STYLE_ID = 'crm-hidden-columns-style';

interface TableInfo {
  id: string;
  title: string;
  labels: string[]; // unique per column ("Name", "Name#2" for repeats)
  display: string[]; // what the user sees in the picker
}

type Hidden = Record<string, string[]>; // tableId -> hidden column keys

const root = () => document.querySelector<HTMLElement>('main[data-view-root]');

const storeKey = (uid: number) => `${STORE}:${uid}`;
function readStore(uid: number): Hidden {
  try { return JSON.parse(localStorage.getItem(storeKey(uid)) || '{}') || {}; } catch { return {}; }
}
function writeStore(uid: number, v: Hidden) {
  try { localStorage.setItem(storeKey(uid), JSON.stringify(v)); } catch { /* storage unavailable */ }
}

function isVisible(el: HTMLElement) {
  return el.getClientRects().length > 0;
}

function titleFor(table: HTMLElement, n: number) {
  const explicit = table.getAttribute('data-columns-title');
  if (explicit) return explicit;
  // Nearest heading above the table gives the picker section a readable name.
  let node: HTMLElement | null = table;
  for (let depth = 0; node && depth < 6; depth++) {
    let sib = node.previousElementSibling as HTMLElement | null;
    while (sib) {
      const h = /^H[1-6]$/.test(sib.tagName) ? sib : sib.querySelector<HTMLElement>('h1,h2,h3,h4');
      if (h && h.textContent?.trim()) return h.textContent.trim().slice(0, 40);
      sib = sib.previousElementSibling as HTMLElement | null;
    }
    node = node.parentElement;
    if (node === root()) break;
  }
  return `Table ${n}`;
}

// Find the list tables worth configuring and stamp each with a stable data-columns-id.
function scan(path: string): TableInfo[] {
  const main = root();
  if (!main) return [];
  const out: TableInfo[] = [];
  let index = 0;
  main.querySelectorAll<HTMLTableElement>('table:not([data-no-columns])').forEach((table) => {
    if (!isVisible(table)) return;
    const headRows = table.querySelectorAll(':scope > thead > tr');
    if (headRows.length !== 1) return;
    const ths = Array.from(headRows[0].children) as HTMLElement[];
    if (ths.length < 3 || ths.some((th) => th.hasAttribute('colspan'))) return;
    index += 1;
    const id = `${path}#${index}`;
    table.setAttribute('data-columns-id', id);
    const seen: Record<string, number> = {};
    const labels: string[] = [];
    const display: string[] = [];
    ths.forEach((th, i) => {
      const text = (th.textContent || '').replace(/\s+/g, ' ').trim();
      const base = text || `Column ${i + 1}`;
      seen[base] = (seen[base] || 0) + 1;
      labels.push(seen[base] > 1 ? `${base}#${seen[base]}` : base);
      display.push(text || `(unnamed column ${i + 1})`);
    });
    out.push({ id, title: titleFor(table, index), labels, display });
  });
  return out;
}

function applyStyles(tables: TableInfo[], hidden: Hidden) {
  const rules: string[] = [];
  for (const t of tables) {
    const keys = new Set(hidden[t.id] || []);
    // Never let a table lose every column.
    if (keys.size >= t.labels.length) continue;
    t.labels.forEach((label, i) => {
      if (!keys.has(label)) return;
      const sel = `table[data-columns-id="${CSS.escape(t.id)}"]`;
      const n = i + 1;
      rules.push(`${sel} > thead > tr > :nth-child(${n}), ${sel} > tbody > tr > td:nth-child(${n}):not([colspan]), ${sel} > tfoot > tr > td:nth-child(${n}):not([colspan]), ${sel} > tfoot > tr > th:nth-child(${n}):not([colspan]){display:none !important}`);
    });
  }
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = rules.join('\n');
}

export default function ColumnVisibility() {
  const pathname = usePathname();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [hidden, setHidden] = useState<Hidden>({});
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<Hidden>({});

  const { user } = useAuth();
  const uid = user?.id ?? 0;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load this user's saved choices: local cache first, then the server copy.
  useEffect(() => {
    if (!uid) return;
    const cached = readStore(uid);
    hiddenRef.current = cached;
     
    setHidden(cached);
    let cancelled = false;
    fetch(`/api/user-preferences?key=${PREF_KEY}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j || !j.value || typeof j.value !== 'object') return;
        hiddenRef.current = j.value as Hidden;
        setHidden(j.value as Hidden);
        writeStore(uid, j.value as Hidden);
        refresh();
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const refresh = useCallback(() => {
    const found = scan(pathname || '');
    applyStyles(found, hiddenRef.current);
    setTables((prev) => (JSON.stringify(prev) === JSON.stringify(found) ? prev : found));
  }, [pathname]);

  // Pages load their rows/tables asynchronously: rescan as the DOM changes.
  useEffect(() => {
    const el = root();
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(el, { childList: true, subtree: true });
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const update = (next: Hidden) => {
    hiddenRef.current = next;
    setHidden(next);
    writeStore(uid, next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch('/api/user-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: PREF_KEY, value: next }),
      }).catch(() => {});
    }, 400);
    applyStyles(tables, next);
  };

  const toggle = (t: TableInfo, label: string) => {
    const cur = new Set(hidden[t.id] || []);
    if (cur.has(label)) cur.delete(label);
    else if (cur.size < t.labels.length - 1) cur.add(label); // keep at least one column
    update({ ...hidden, [t.id]: Array.from(cur) });
  };

  const reset = (t: TableInfo) => {
    const next = { ...hidden };
    delete next[t.id];
    update(next);
  };

  if (tables.length === 0) return null;
  const hiddenCount = tables.reduce((n, t) => n + (hidden[t.id]?.length || 0), 0);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Show or hide columns"
        className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${hiddenCount ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
      >
        <Columns3 className="h-3.5 w-3.5" />
        Columns{hiddenCount ? ` (${hiddenCount} hidden)` : ''}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 text-xs shadow-lg">
          {tables.map((t) => (
            <div key={t.id} className="mb-2 last:mb-0">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="font-semibold text-gray-700">{tables.length > 1 ? t.title : 'Show columns'}</span>
                {(hidden[t.id]?.length || 0) > 0 && (
                  <button type="button" onClick={() => reset(t)} className="text-blue-600 hover:underline">Show all</button>
                )}
              </div>
              {t.labels.map((label, i) => {
                const checked = !(hidden[t.id] || []).includes(label);
                return (
                  <label key={label} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-gray-50">
                    <input type="checkbox" checked={checked} onChange={() => toggle(t, label)} />
                    <span className="truncate text-gray-700">{t.display[i]}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
