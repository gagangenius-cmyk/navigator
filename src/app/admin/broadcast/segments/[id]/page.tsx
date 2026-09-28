'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  SegmentFilterGroupEditor,
  emptySegmentGroup,
  type SegmentGroup,
  type SegmentFieldOptionLists,
  type SegmentOption,
} from '@/components/broadcast/SegmentFilterBuilder';

interface SegmentDetail {
  id: number;
  name: string;
  description: string | null;
  isShared: boolean;
  filterAst: SegmentGroup;
  lastEstimatedCount: number | null;
  lastEstimatedAt: string | null;
}

export default function SegmentEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = params.id === 'new';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [filterAst, setFilterAst] = useState<SegmentGroup>(emptySegmentGroup());
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [lastEstimatedAt, setLastEstimatedAt] = useState<string | null>(null);

  const [options, setOptions] = useState<SegmentFieldOptionLists>({});
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Reuses the existing Leads filter-options endpoint (branches/regions/
  // statuses - the exact same lists the main Leads page's own filter bar
  // uses) plus the active-employees list, rather than building new option
  // endpoints for fields this segment builder shares with other screens.
  useEffect(() => {
    (async () => {
      try {
        const [filterRes, employeesRes] = await Promise.all([
          fetch('/api/lead-filter-options'),
          fetch('/api/employees/active'),
        ]);
        const filterData = await filterRes.json();
        const employees = await employeesRes.json();
        const toOptions = (rows: { value: string; label: string }[] | undefined): SegmentOption[] => rows ?? [];
        setOptions({
          branch: toOptions(filterData.branches),
          region: toOptions(filterData.regions),
          status: toOptions(filterData.statuses),
          assignTo: Array.isArray(employees)
            ? employees.map((e: { id: number; name: string }) => ({ value: String(e.id), label: e.name }))
            : [],
        });
      } catch {
        // Option lists are a convenience (dropdowns) - their absence just
        // falls back to plain text/number inputs, never blocks the builder.
      }
    })();
  }, []);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/broadcast/segments/${params.id}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load segment');
        if (cancelled) return;
        const segment = data.segment as SegmentDetail;
        setName(segment.name);
        setDescription(segment.description ?? '');
        setIsShared(segment.isShared);
        setFilterAst(segment.filterAst ?? emptySegmentGroup());
        setEstimatedCount(segment.lastEstimatedCount);
        setLastEstimatedAt(segment.lastEstimatedAt);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load segment');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isNew, params.id]);

  async function estimate() {
    setEstimating(true);
    setError(null);
    try {
      const res = await fetch('/api/broadcast/segments/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterAst }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to estimate segment');
      setEstimatedCount(data.estimatedCount);
      setLastEstimatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to estimate segment');
    } finally {
      setEstimating(false);
    }
  }

  async function save() {
    if (!name.trim()) return setError('Name is required');
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = { name, description: description || null, isShared, filterAst };
      const res = await fetch(isNew ? '/api/broadcast/segments' : `/api/broadcast/segments/${params.id}`, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save segment');
      if (isNew) {
        router.push(`/admin/broadcast/segments/${data.segment.id}`);
        return;
      }
      setEstimatedCount(data.segment.lastEstimatedCount);
      setLastEstimatedAt(data.segment.lastEstimatedAt);
      setNotice('Segment saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save segment');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-4 text-sm text-[var(--cmg-muted)]">Loading…</div>;

  return (
    <div className="flex flex-col gap-4 p-3 lg:p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--cmg-ink)]">{isNew ? 'New segment' : name}</h1>
          <p className="text-sm text-[var(--cmg-muted)]">A saved lead filter used to target broadcast campaigns.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => router.push('/admin/broadcast/segments')}>
          Back to segments
        </Button>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--cmg-red)]">{error}</p>}
      {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Segment details</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Warm Canada leads, Dubai" />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
              Description (optional)
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
            Shared with everyone in my branch (otherwise only I can use it)
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Filter</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SegmentFilterGroupEditor group={filterAst} options={options} onChange={setFilterAst} />

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--cmg-border)] pt-3">
            <Button type="button" variant="outline" disabled={estimating} onClick={estimate}>
              {estimating ? 'Estimating…' : 'Estimate recipients'}
            </Button>
            {estimatedCount !== null && (
              <span className="text-sm text-[var(--cmg-muted)]">
                <span className="font-semibold text-[var(--cmg-ink)]">{estimatedCount}</span> matching lead{estimatedCount === 1 ? '' : 's'}
                {lastEstimatedAt ? ` · as of ${new Date(lastEstimatedAt).toLocaleString()}` : ''}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={saving} onClick={save}>
          {saving ? 'Saving…' : isNew ? 'Create segment' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
