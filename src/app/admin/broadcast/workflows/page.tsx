'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface WorkflowRow {
  id: number;
  workflowType: 'automation' | 'bot';
  name: string;
  status: 'draft' | 'published' | 'archived';
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/broadcast/workflows');
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load workflows');
        if (!cancelled) setWorkflows(data.workflows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load workflows');
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
          <h1 className="text-2xl font-semibold text-[var(--cmg-ink)]">Workflow Automation</h1>
          <p className="text-sm text-[var(--cmg-muted)]">Visual automation and bot flows, built on React Flow.</p>
        </div>
        <Link href="/admin/broadcast/workflows/new">
          <Button>New workflow</Button>
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">All workflows</CardTitle></CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--cmg-muted)]">Loading…</p>}
          {error && <p className="text-sm text-[var(--cmg-red)]">{error}</p>}
          {!loading && !error && workflows.length === 0 && (
            <p className="text-sm text-[var(--cmg-muted)]">No workflows yet.</p>
          )}
          {!loading && workflows.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cmg-border)] text-left text-[var(--cmg-muted)]">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((workflow) => (
                  <tr key={workflow.id} className="border-b border-[var(--cmg-border)]/50 last:border-0">
                    <td className="py-2 pr-4 font-medium">{workflow.name}</td>
                    <td className="py-2 pr-4">{workflow.workflowType}</td>
                    <td className="py-2 pr-4">{workflow.status}</td>
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
