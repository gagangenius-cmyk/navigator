'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface TemplateRow {
  id: number;
  channel: 'email' | 'whatsapp' | 'sms';
  name: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';
  language: string;
  updatedAt: string;
}

const CHANNEL_LABEL: Record<TemplateRow['channel'], string> = { email: 'Email', whatsapp: 'WhatsApp', sms: 'SMS' };
const STATUS_STYLE: Record<TemplateRow['status'], string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  archived: 'bg-gray-100 text-gray-500',
};

export default function TemplateLibraryPage() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/broadcast/templates');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load templates');
        if (!cancelled) setTemplates(data.templates);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load templates');
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
          <h1 className="text-2xl font-semibold text-[var(--cmg-ink)]">Template Library</h1>
          <p className="text-sm text-[var(--cmg-muted)]">Email, WhatsApp, and SMS message templates for broadcast campaigns.</p>
        </div>
        <Link href="/admin/broadcast/templates/new">
          <Button>New template</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All templates</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--cmg-muted)]">Loading…</p>}
          {error && <p className="text-sm text-[var(--cmg-red)]">{error}</p>}
          {!loading && !error && templates.length === 0 && (
            <p className="text-sm text-[var(--cmg-muted)]">No templates yet. Create your first one to get started.</p>
          )}
          {!loading && templates.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cmg-border)] text-left text-[var(--cmg-muted)]">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Channel</th>
                  <th className="py-2 pr-4 font-medium">Language</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.id} className="border-b border-[var(--cmg-border)]/50 last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/admin/broadcast/templates/${template.id}`} className="font-medium text-[var(--cmg-blue)] hover:underline">
                        {template.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{CHANNEL_LABEL[template.channel]}</td>
                    <td className="py-2 pr-4">{template.language}</td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[template.status]}`}>
                        {template.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-[var(--cmg-muted)]">{new Date(template.updatedAt).toLocaleString()}</td>
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
