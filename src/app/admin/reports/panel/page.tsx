'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Clock, DollarSign, FileText, Search, Star, Target, TrendingUp, Users, Award, Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessAdminPath } from '@/lib/roleAccess';
import { RecordCard, RecordList } from '@/components/shared/ResponsiveRecordList';

// The reports that exist in the CRM, grouped by area. Only reports the signed-in user may open are listed.
interface CatalogReport {
  id: string;
  name: string;
  description: string;
  folder: 'Leads' | 'Sales' | 'Finance' | 'Branch' | 'Tools';
  href: string;
  icon: typeof BarChart3;
}

const CATALOG: CatalogReport[] = [
  { id: 'lead-status', name: 'Lead Status & My Daily Work', description: 'Daily / weekly lead work: status changes, follow-ups, appointments, with Excel / CSV export.', folder: 'Leads', href: '/admin/reports/lead-status', icon: Users },
  { id: 'lead-source', name: 'Lead Source Analytics', description: 'Where leads come from and how each source converts.', folder: 'Leads', href: '/admin/reports/lead-source-analytics', icon: TrendingUp },
  { id: 'lead-performance', name: 'Lead Performance', description: 'Leads handled and outcomes per counselor.', folder: 'Leads', href: '/admin/reports/lead-performance', icon: Award },
  { id: 'lead-funnel', name: 'Conversion Funnel', description: 'Lead to opportunity to contract conversion by stage.', folder: 'Leads', href: '/admin/reports/lead-conversion-funnel', icon: Target },
  { id: 'lead-aging', name: 'Lead Aging', description: 'How long leads have been sitting in each status.', folder: 'Leads', href: '/admin/reports/lead-aging', icon: Clock },
  { id: 'sales-performance', name: 'Sales Performance', description: 'Revenue and contracts by counselor and period.', folder: 'Sales', href: '/admin/reports/sales-performance', icon: DollarSign },
  { id: 'finance', name: 'Finance Report', description: 'Payments, receipts and outstanding balances.', folder: 'Finance', href: '/admin/reports/finance', icon: DollarSign },
  { id: 'branch-performance', name: 'Branch Performance', description: 'Leads, contracts and revenue per branch.', folder: 'Branch', href: '/admin/reports/branch-performance', icon: Building2 },
  { id: 'generator', name: 'Report Generator', description: 'Build a custom report from CRM data.', folder: 'Tools', href: '/admin/reports/generator', icon: FileText },
];

const FOLDERS = ['All', 'Leads', 'Sales', 'Finance', 'Branch', 'Tools'] as const;
const FAV_KEY = 'reports-panel-favorites';
const RECENT_KEY = 'reports-panel-recent';

const readList = (key: string): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

export default function ReportsPanel() {
  const { user } = useAuth();
  const [view, setView] = useState<'all' | 'favorites' | 'recent'>('all');
  const [folder, setFolder] = useState<(typeof FOLDERS)[number]>('All');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    // localStorage is only readable in the browser, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavorites(readList(FAV_KEY));
    setRecent(readList(RECENT_KEY));
  }, []);

  const allowed = useMemo(() => CATALOG.filter((r) => canAccessAdminPath(user, r.href)), [user]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allowed
      .filter((r) => folder === 'All' || r.folder === folder)
      .filter((r) => view !== 'favorites' || favorites.includes(r.id))
      .filter((r) => view !== 'recent' || recent.includes(r.id))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
      .sort((a, b) => (view === 'recent' ? recent.indexOf(a.id) - recent.indexOf(b.id) : 0));
  }, [allowed, folder, view, favorites, recent, search]);

  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    setFavorites(next);
    localStorage.setItem(FAV_KEY, JSON.stringify(next));
  };

  const markOpened = (id: string) => {
    const next = [id, ...recent.filter((r) => r !== id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  const tabs = [
    { id: 'all', label: 'All reports' },
    { id: 'favorites', label: 'Favorites' },
    { id: 'recent', label: 'Recently opened' },
  ] as const;

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-600">{shown.length} of {allowed.length} reports available to you</p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:border-transparent focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setView(t.id)} className={`rounded-md border px-3 py-1.5 text-sm font-medium ${view === t.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>{t.label}</button>
        ))}
        <span className="mx-2 hidden w-px bg-gray-200 sm:block" />
        {FOLDERS.map((f) => (
          <button key={f} type="button" onClick={() => setFolder(f)} className={`rounded-md border px-3 py-1.5 text-sm ${folder === f ? 'border-blue-200 bg-blue-50 font-medium text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>{f === 'All' ? 'All folders' : f}</button>
        ))}
      </div>

      <RecordList isEmpty={false}>
        {shown.map((report) => {
          const Icon = report.icon;
          const fav = favorites.includes(report.id);
          return (
            <RecordCard
              key={report.id}
              avatar={<Icon className="h-4 w-4 text-white" />}
              avatarColorClass="from-blue-600 to-blue-400"
              title={<Link href={report.href} onClick={() => markOpened(report.id)} className="min-w-0 break-words text-base font-bold text-gray-950 hover:text-blue-700">{report.name}</Link>}
              titleBadges={<span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{report.folder}</span>}
              stats={[{ label: 'About', value: report.description }]}
              extra={
                <button type="button" onClick={() => toggleFavorite(report.id)} className={`mt-2 flex w-fit items-center rounded-full px-3 py-1 text-xs font-medium ${fav ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  <Star className={`mr-1 h-3 w-3 ${fav ? 'fill-current' : ''}`} />
                  {fav ? 'Favorite' : 'Add to favorites'}
                </button>
              }
              actions={[{ key: 'open', icon: BarChart3, label: 'Open', onClick: () => { markOpened(report.id); window.location.href = report.href; } }]}
            />
          );
        })}
      </RecordList>

      {shown.length === 0 && (
        <div className="py-12 text-center">
          <FileText className="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <h3 className="mb-2 text-lg font-medium text-gray-900">No reports found</h3>
          <p className="text-gray-600">Try another folder, tab or search.</p>
        </div>
      )}
    </div>
  );
}
