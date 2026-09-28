'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SegmentRow {
  id: number;
  name: string;
  description: string | null;
  isShared: boolean;
  lastEstimatedCount: number | null;
  lastEstimatedAt: string | null;
}

export default function SegmentsPage() {
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/broadcast/segments');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load segments');
        if (!cancelled) setSegments(data.segments);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load segments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col gap-4 p-3 lg:p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--cmg-ink)]">Audience Segments</h1>
          <p className="text-sm text-[var(--cmg-muted)]">Saved lead filters used to target broadcast campaigns.</p>
        </div>
        <Link href="/admin/broadcast/segments/new">
          <Button>New segment</Button>
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">All segments</CardTitle></CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--cmg-muted)]">Loading…</p>}
          {error && <p className="text-sm text-[var(--cmg-red)]">{error}</p>}
          {!loading && !error && segments.length === 0 && (
            <p className="text-sm text-[var(--cmg-muted)]">No segments yet.</p>
          )}
          {!loading && segments.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cmg-border)] text-left text-[var(--cmg-muted)]">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Shared</th>
                  <th className="py-2 pr-4 font-medium">Estimated recipients</th>
                  <th className="py-2 pr-4 font-medium">Last estimated</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((segment) => (
                  <tr key={segment.id} className="border-b border-[var(--cmg-border)]/50 last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/admin/broadcast/segments/${segment.id}`} className="font-medium text-[var(--cmg-blue)] hover:underline">
                        {segment.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{segment.isShared ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-4">{segment.lastEstimatedCount ?? '—'}</td>
                    <td className="py-2 pr-4 text-[var(--cmg-muted)]">
                      {segment.lastEstimatedAt ? new Date(segment.lastEstimatedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
