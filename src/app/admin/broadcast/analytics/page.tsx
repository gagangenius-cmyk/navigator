'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AnalyticsData {
  campaignsByStatus: Record<string, number>;
  recipientsByStatus: Record<string, number>;
  enrollmentsByStatus: Record<string, number>;
  stepsByStatus: Record<string, number>;
  failedRecipients: { id: number; campaignId: number; channel: string; addressSnapshot: string; failureReason: string | null; attempts: number; updatedAt: string }[];
  failedSteps: { id: number; enrollmentId: number; nodeId: string; nodeType: string; errorMessage: string | null; attempt: number; completedAt: string | null }[];
  quotas: { channel: string; withinQuota: boolean; limit: number | null; sentToday: number }[];
}

function CountRow({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return <p className="text-sm text-[var(--cmg-muted)]">No data yet.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([status, count]) => (
        <span key={status} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
          <span className="font-semibold">{count}</span> <span className="text-[var(--cmg-muted)]">{status}</span>
        </span>
      ))}
    </div>
  );
}

export default function BroadcastAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/broadcast/analytics');
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load analytics');
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load analytics');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col gap-4 p-3 lg:p-4">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--cmg-ink)]">Broadcast & Workflow Analytics</h1>
        <p className="text-sm text-[var(--cmg-muted)]">Campaign funnel, workflow health, quotas, and recent failures - computed from live data, no separate reporting pipeline.</p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--cmg-red)]">{error}</p>}
      {!data && !error && <p className="text-sm text-[var(--cmg-muted)]">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Campaigns by status</CardTitle></CardHeader>
              <CardContent><CountRow counts={data.campaignsByStatus} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Recipients by status (send funnel)</CardTitle></CardHeader>
              <CardContent><CountRow counts={data.recipientsByStatus} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Workflow enrollments by status</CardTitle></CardHeader>
              <CardContent><CountRow counts={data.enrollmentsByStatus} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Workflow steps by status</CardTitle></CardHeader>
              <CardContent><CountRow counts={data.stepsByStatus} /></CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Daily send quotas</CardTitle></CardHeader>
            <CardContent>
              <div className="flex gap-4">
                {data.quotas.map((q) => (
                  <div key={q.channel} className={`rounded-md border p-3 text-sm ${q.withinQuota ? 'border-[var(--cmg-border)]' : 'border-[var(--cmg-red)] bg-red-50'}`}>
                    <div className="font-medium capitalize">{q.channel}</div>
                    <div>{q.sentToday} sent today{q.limit ? ` / ${q.limit} limit` : ' (no limit set)'}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Recent failed sends (dead-letter)</CardTitle></CardHeader>
            <CardContent>
              {data.failedRecipients.length === 0 && <p className="text-sm text-[var(--cmg-muted)]">None.</p>}
              {data.failedRecipients.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--cmg-border)] text-left text-[var(--cmg-muted)]">
                      <th className="py-2 pr-4 font-medium">Campaign</th>
                      <th className="py-2 pr-4 font-medium">Channel</th>
                      <th className="py-2 pr-4 font-medium">Address</th>
                      <th className="py-2 pr-4 font-medium">Reason</th>
                      <th className="py-2 pr-4 font-medium">Attempts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.failedRecipients.map((r) => (
                      <tr key={r.id} className="border-b border-[var(--cmg-border)]/50 last:border-0">
                        <td className="py-2 pr-4">#{r.campaignId}</td>
                        <td className="py-2 pr-4">{r.channel}</td>
                        <td className="py-2 pr-4">{r.addressSnapshot}</td>
                        <td className="py-2 pr-4 text-[var(--cmg-red)]">{r.failureReason ?? '—'}</td>
                        <td className="py-2 pr-4">{r.attempts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Recent failed workflow steps (dead-letter)</CardTitle></CardHeader>
            <CardContent>
              {data.failedSteps.length === 0 && <p className="text-sm text-[var(--cmg-muted)]">None.</p>}
              {data.failedSteps.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--cmg-border)] text-left text-[var(--cmg-muted)]">
                      <th className="py-2 pr-4 font-medium">Enrollment</th>
                      <th className="py-2 pr-4 font-medium">Node</th>
                      <th className="py-2 pr-4 font-medium">Error</th>
                      <th className="py-2 pr-4 font-medium">Attempt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.failedSteps.map((s) => (
                      <tr key={s.id} className="border-b border-[var(--cmg-border)]/50 last:border-0">
                        <td className="py-2 pr-4">#{s.enrollmentId}</td>
                        <td className="py-2 pr-4">{s.nodeType} ({s.nodeId})</td>
                        <td className="py-2 pr-4 text-[var(--cmg-red)]">{s.errorMessage ?? '—'}</td>
                        <td className="py-2 pr-4">{s.attempt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
