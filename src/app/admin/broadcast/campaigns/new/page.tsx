'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select-simple';

type Channel = 'email' | 'whatsapp' | 'sms';
type Step = 'audience' | 'template' | 'mapping' | 'preview' | 'schedule';

interface SegmentRow { id: number; name: string; lastEstimatedCount: number | null }
interface TemplateRow { id: number; channel: Channel; name: string; status: string; currentPublishedVersionId: number | null }

const STEPS: Step[] = ['audience', 'template', 'mapping', 'preview', 'schedule'];
const STEP_LABEL: Record<Step, string> = {
  audience: '1. Audience', template: '2. Template', mapping: '3. Variables', preview: '4. Preview', schedule: '5. Schedule & Launch',
};
const LEAD_FIELDS = ['fname', 'lname', 'email', 'mobile', 'whatsapp_number'] as const;

export default function NewCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('audience');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [channel, setChannel] = useState<Channel>('email');
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [segmentId, setSegmentId] = useState<number | null>(null);

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateVersionId, setTemplateVersionId] = useState<number | null>(null);

  const [variableMapping, setVariableMapping] = useState<Record<string, { source: 'lead_field'; field: string } | { source: 'static'; value: string }>>({});
  const [newVarName, setNewVarName] = useState('');

  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null);
  const [previewMissing, setPreviewMissing] = useState<string[]>([]);

  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [launchSummary, setLaunchSummary] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch('/api/broadcast/segments').then((r) => r.json()).then((d) => { if (d.success) setSegments(d.segments); });
  }, []);

  useEffect(() => {
    fetch(`/api/broadcast/templates?channel=${channel}&status=approved`).then((r) => r.json()).then((d) => { if (d.success) setTemplates(d.templates); });
  }, [channel]);

  const selectedTemplate = templates.find((t) => t.currentPublishedVersionId === templateVersionId);
  const stepIndex = STEPS.indexOf(step);

  async function ensureDraftCampaign(): Promise<number> {
    if (campaignId) return campaignId;
    if (!name.trim()) throw new Error('Campaign name is required');
    if (!templateVersionId) throw new Error('Select a template first');
    const res = await fetch('/api/broadcast/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, templateVersionId, segmentId }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create campaign draft');
    setCampaignId(data.campaign.id);
    return data.campaign.id;
  }

  async function goToMapping() {
    setError(null);
    if (!segmentId) return setError('Select a segment first');
    if (!templateVersionId) return setError('Select a template first');
    setStep('mapping');
  }

  async function goToPreview() {
    setError(null);
    setSaving(true);
    try {
      const id = await ensureDraftCampaign();
      const res = await fetch(`/api/broadcast/campaigns/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId, variableMapping }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save campaign');

      const previewRes = await fetch(`/api/broadcast/templates/${selectedTemplate?.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: templateVersionId, variables: {} }),
      });
      const previewData = await previewRes.json();
      if (previewRes.ok && previewData.success) {
        setPreviewResult(previewData.rendered);
        setPreviewMissing([]);
      } else {
        setPreviewResult(null);
        setPreviewMissing(previewData.missing ?? []);
      }
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to proceed to preview');
    } finally {
      setSaving(false);
    }
  }

  async function handleLaunch() {
    setError(null);
    setSaving(true);
    try {
      const id = await ensureDraftCampaign();
      if (scheduleMode === 'later' && scheduledAt) {
        await fetch(`/api/broadcast/campaigns/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduledAtUtc: new Date(scheduledAt).toISOString(), scheduledTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        });
      }
      const res = await fetch(`/api/broadcast/campaigns/${id}/launch`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to launch campaign');
      setLaunchSummary(data.summary);
      setNotice(scheduleMode === 'later' ? 'Campaign scheduled.' : 'Campaign launched.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch');
    } finally {
      setSaving(false);
    }
  }

  const variableNames = useMemo(() => Object.keys(variableMapping), [variableMapping]);

  return (
    <div className="flex flex-col gap-4 p-3 lg:p-4">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--cmg-ink)]">New Campaign</h1>
        <div className="mt-2 flex gap-2 text-sm">
          {STEPS.map((s, i) => (
            <span key={s} className={`rounded-full px-3 py-1 ${i === stepIndex ? 'bg-[var(--cmg-blue)] text-white' : i < stepIndex ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
              {STEP_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--cmg-red)]">{error}</p>}
      {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {step === 'audience' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Audience & channel</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Campaign name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. September Newsletter" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Channel
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Segment
              <Select value={segmentId ? String(segmentId) : undefined} onValueChange={(v) => setSegmentId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Choose a segment" /></SelectTrigger>
                <SelectContent>
                  {segments.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.lastEstimatedCount ?? '?'} recipients)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {segments.length === 0 && <span className="text-xs text-[var(--cmg-muted)]">No segments yet - create one via POST /api/broadcast/segments first.</span>}
            </label>
            <div className="flex justify-end">
              <Button disabled={!name.trim() || !segmentId} onClick={() => setStep('template')}>Next: Template</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'template' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Choose an approved template</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {templates.length === 0 && (
              <p className="text-sm text-[var(--cmg-muted)]">No approved {channel} templates yet. Publish one from the Template Library first.</p>
            )}
            <div className="flex flex-col gap-2">
              {templates.map((t) => (
                <label key={t.id} className="flex items-center gap-2 rounded-md border border-[var(--cmg-border)] p-2 text-sm">
                  <input
                    type="radio"
                    name="template"
                    disabled={!t.currentPublishedVersionId}
                    checked={templateVersionId === t.currentPublishedVersionId}
                    onChange={() => setTemplateVersionId(t.currentPublishedVersionId)}
                  />
                  {t.name} {!t.currentPublishedVersionId && <span className="text-xs text-[var(--cmg-muted)]">(no published version)</span>}
                </label>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('audience')}>Back</Button>
              <Button disabled={!templateVersionId} onClick={goToMapping}>Next: Variables</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'mapping' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Map template variables</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-xs text-[var(--cmg-muted)]">Map each {'{{variable}}'} in your template to a lead field or a fixed value. Add one variable name at a time.</p>
            <div className="flex gap-2">
              <Input placeholder="variable name, e.g. first_name" value={newVarName} onChange={(e) => setNewVarName(e.target.value)} />
              <Button
                variant="outline"
                onClick={() => {
                  if (!newVarName.trim()) return;
                  setVariableMapping((prev) => ({ ...prev, [newVarName.trim()]: { source: 'lead_field', field: 'fname' } }));
                  setNewVarName('');
                }}
              >
                Add
              </Button>
            </div>
            {variableNames.map((varName) => {
              const entry = variableMapping[varName];
              return (
                <div key={varName} className="flex items-center gap-2 rounded-md border border-[var(--cmg-border)] p-2 text-sm">
                  <span className="w-32 font-mono">{'{{' + varName + '}}'}</span>
                  <Select value={entry.source} onValueChange={(v) => setVariableMapping((prev) => ({ ...prev, [varName]: v === 'lead_field' ? { source: 'lead_field', field: 'fname' } : { source: 'static', value: '' } }))}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead_field">Lead field</SelectItem>
                      <SelectItem value="static">Fixed value</SelectItem>
                    </SelectContent>
                  </Select>
                  {entry.source === 'lead_field' ? (
                    <Select value={entry.field} onValueChange={(v) => setVariableMapping((prev) => ({ ...prev, [varName]: { source: 'lead_field', field: v } }))}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {LEAD_FIELDS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input className="w-40" value={entry.value} onChange={(e) => setVariableMapping((prev) => ({ ...prev, [varName]: { source: 'static', value: e.target.value } }))} />
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setVariableMapping((prev) => { const next = { ...prev }; delete next[varName]; return next; })}>Remove</Button>
                </div>
              );
            })}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('template')}>Back</Button>
              <Button disabled={saving} onClick={goToPreview}>{saving ? 'Saving…' : 'Next: Preview'}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'preview' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Preview</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {previewMissing.length > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Missing sample values for: {previewMissing.join(', ')} - preview shown with placeholders unresolved. Add sample values on the template to preview fully.
              </p>
            )}
            {previewResult && (
              <pre className="whitespace-pre-wrap rounded-md border border-[var(--cmg-border)] bg-gray-50 p-3 text-sm">{JSON.stringify(previewResult, null, 2)}</pre>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep('mapping')}>Back</Button>
              <Button onClick={() => setStep('schedule')}>Next: Schedule</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'schedule' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Compliance preflight & schedule</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-xs text-[var(--cmg-muted)]">
              Launch runs the full preflight server-side: template approval (WhatsApp requires a real Meta-approved template),
              suppression list, and per-recipient consent - see <code>POST /api/broadcast/campaigns/[id]/launch</code>.
            </p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={scheduleMode === 'now'} onChange={() => setScheduleMode('now')} /> Launch now
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={scheduleMode === 'later'} onChange={() => setScheduleMode('later')} /> Schedule for later
              </label>
            </div>
            {scheduleMode === 'later' && (
              <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            )}
            {launchSummary ? (
              <div className="rounded-md bg-green-50 p-3 text-sm text-green-900">
                <p className="font-medium">Done.</p>
                <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(launchSummary, null, 2)}</pre>
                <Button size="sm" className="mt-2" onClick={() => router.push('/admin/broadcast/campaigns')}>View campaigns</Button>
              </div>
            ) : (
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep('preview')}>Back</Button>
                <Button disabled={saving || (scheduleMode === 'later' && !scheduledAt)} onClick={handleLaunch}>
                  {saving ? 'Working…' : scheduleMode === 'now' ? 'Launch campaign' : 'Schedule campaign'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
