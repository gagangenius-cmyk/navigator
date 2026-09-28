'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CampaignRow {
  id: number;
  channel: 'email' | 'whatsapp' | 'sms';
  name: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-blue-100 text-blue-800',
  running: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  paused: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-800',
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/broadcast/campaigns');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load campaigns');
        if (!cancelled) setCampaigns(data.campaigns);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load campaigns');
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
          <h1 className="text-2xl font-semibold text-[var(--cmg-ink)]">Broadcast Campaigns</h1>
          <p className="text-sm text-[var(--cmg-muted)]">
            {process.env.NODE_ENV !== 'production' && 'Note: sending is a no-op until BROADCAST_AUTOMATION_ENABLED=true.'}
          </p>
        </div>
        <Link href="/admin/broadcast/campaigns/new">
          <Button>New campaign</Button>
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">All campaigns</CardTitle></CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--cmg-muted)]">Loading…</p>}
          {error && <p className="text-sm text-[var(--cmg-red)]">{error}</p>}
          {!loading && !error && campaigns.length === 0 && (
            <p className="text-sm text-[var(--cmg-muted)]">No campaigns yet.</p>
          )}
          {!loading && campaigns.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cmg-border)] text-left text-[var(--cmg-muted)]">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Channel</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Recipients</th>
                  <th className="py-2 pr-4 font-medium">Sent / Delivered / Failed</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="border-b border-[var(--cmg-border)]/50 last:border-0">
                    <td className="py-2 pr-4 font-medium">{campaign.name}</td>
                    <td className="py-2 pr-4">{campaign.channel}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[campaign.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {campaign.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{campaign.totalRecipients}</td>
                    <td className="py-2 pr-4 text-[var(--cmg-muted)]">
                      {campaign.sentCount} / {campaign.deliveredCount} / {campaign.failedCount}
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
