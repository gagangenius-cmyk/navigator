'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select-simple';
import type { WorkflowGraph, WorkflowGraphError } from '@/lib/workflowGraphValidator';

// React Flow reads window/DOM APIs at import time - client-only, matching
// the same dynamic-import-with-ssr-false pattern as EmailTemplateEditor.
const WorkflowCanvas = dynamic(
  () => import('@/components/broadcast/WorkflowCanvas').then((mod) => mod.WorkflowCanvas),
  { ssr: false, loading: () => <div className="flex h-[70vh] items-center justify-center text-sm text-[var(--cmg-muted)]">Loading canvas…</div> }
);

interface WorkflowDetail {
  id: number;
  workflowType: 'automation' | 'bot';
  name: string;
  status: string;
  currentDraftVersionId: number | null;
  currentPublishedVersionId: number | null;
}

interface WorkflowVersion {
  id: number;
  versionNumber: number;
  graphJson: WorkflowGraph;
  isPublished: boolean;
}

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = params.id === 'new';

  const [name, setName] = useState('');
  const [workflowType, setWorkflowType] = useState<'automation' | 'bot'>('automation');
  const [workflow, setWorkflow] = useState<WorkflowDetail | null>(null);
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<WorkflowGraphError[]>([]);

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/broadcast/workflows/${params.id}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load workflow');
        if (cancelled) return;
        setWorkflow(data.workflow);
        setVersions(data.versions);
        setName(data.workflow.name);
        setWorkflowType(data.workflow.workflowType);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load workflow');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isNew, params.id]);

  const draftVersion = versions.find((v) => v.id === workflow?.currentDraftVersionId) ?? versions[0] ?? null;

  async function handleValidate(graph: WorkflowGraph) {
    setError(null);
    try {
      const res = await fetch('/api/broadcast/workflows/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Validation request failed');
      setValidationErrors(data.errors);
      setNotice(data.valid ? 'Graph is valid.' : `${data.errors.length} validation error(s) found.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
    }
  }

  async function handleSave(graph: WorkflowGraph) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (isNew) {
        if (!name.trim()) throw new Error('Name is required');
        const res = await fetch('/api/broadcast/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, workflowType, graph }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setValidationErrors(data.errors ?? []);
          throw new Error(data.error || 'Failed to create workflow');
        }
        router.push(`/admin/broadcast/workflows/${data.workflow.id}`);
        return;
      }

      const res = await fetch(`/api/broadcast/workflows/${workflow!.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setValidationErrors(data.errors ?? []);
        throw new Error(data.error || 'Failed to save version');
      }
      setValidationErrors([]);
      setNotice(`Saved as version ${data.version.versionNumber}`);
      setVersions((prev) => [data.version, ...prev]);
      setWorkflow((prev) => (prev ? { ...prev, currentDraftVersionId: data.version.id } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish(versionId: number) {
    if (!workflow) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/broadcast/workflows/${workflow.id}/versions/${versionId}/publish`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setValidationErrors(data.errors ?? []);
        throw new Error(data.error || 'Failed to publish');
      }
      setWorkflow(data.workflow);
      setNotice(`Version ${data.version.versionNumber} published`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-4 text-sm text-[var(--cmg-muted)]">Loading…</div>;

  return (
    <div className="flex flex-col gap-4 p-3 lg:p-4">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--cmg-ink)]">{isNew ? 'New workflow' : name}</h1>
        <p className="text-sm text-[var(--cmg-muted)]">
          {isNew ? 'Design your automation or bot flow on the canvas below.' : `${workflowType} · ${workflow?.status}`}
        </p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--cmg-red)]">{error}</p>}
      {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {isNew && (
        <div className="flex gap-4 rounded-lg border border-[var(--cmg-border)] bg-white p-4">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Lead Welcome Sequence" />
          </label>
          <label className="flex w-48 flex-col gap-1 text-sm font-medium">
            Type
            <Select value={workflowType} onValueChange={(v) => setWorkflowType(v as 'automation' | 'bot')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="automation">Automation</SelectItem>
                <SelectItem value="bot">Bot</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
      )}

      <WorkflowCanvas
        initialGraph={draftVersion?.graphJson ?? null}
        onSave={handleSave}
        onValidate={handleValidate}
        saving={saving}
        validationErrors={validationErrors}
      />

      {!isNew && versions.length > 0 && (
        <div className="rounded-lg border border-[var(--cmg-border)] bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Version history</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--cmg-border)] text-left text-[var(--cmg-muted)]">
                <th className="py-2 pr-4 font-medium">Version</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium" />
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr key={version.id} className="border-b border-[var(--cmg-border)]/50 last:border-0">
                  <td className="py-2 pr-4">v{version.versionNumber}</td>
                  <td className="py-2 pr-4">{version.isPublished ? 'Published' : 'Draft'}</td>
                  <td className="py-2 pr-4">
                    {!version.isPublished && (
                      <Button size="sm" variant="outline" disabled={saving} onClick={() => handlePublish(version.id)}>Publish</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
