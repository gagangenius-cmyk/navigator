'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select-simple';
import { EmailTemplateEditor, type EmailTemplateSaveResult } from '@/components/broadcast/EmailTemplateEditor';
import { estimateSmsSegments } from '@/lib/broadcastTemplateRender';

type Channel = 'email' | 'whatsapp' | 'sms';

interface TemplateDetail {
  id: number;
  channel: Channel;
  name: string;
  status: string;
  currentDraftVersionId: number | null;
  currentPublishedVersionId: number | null;
}

interface TemplateVersion {
  id: number;
  versionNumber: number;
  channel: Channel;
  components: Record<string, unknown>;
  designJson: Record<string, unknown> | null;
  isPublished: boolean;
  createdAt: string;
}

export default function TemplateEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = params.id === 'new';

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<Channel | null>(isNew ? null : null);
  const [whatsappBody, setWhatsappBody] = useState('');
  const [whatsappFooter, setWhatsappFooter] = useState('');
  const [smsText, setSmsText] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const draftVersion = useMemo(
    () => versions.find((v) => v.id === template?.currentDraftVersionId) ?? versions[0] ?? null,
    [versions, template]
  );

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/broadcast/templates/${params.id}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load template');
        if (cancelled) return;
        setTemplate(data.template);
        setVersions(data.versions);
        setName(data.template.name);
        setChannel(data.template.channel);
        const latest = data.versions.find((v: TemplateVersion) => v.id === data.template.currentDraftVersionId) ?? data.versions[0];
        if (latest?.channel === 'whatsapp') {
          setWhatsappBody((latest.components as { body?: { text?: string } })?.body?.text ?? '');
          setWhatsappFooter((latest.components as { footer?: { text?: string } })?.footer?.text ?? '');
        } else if (latest?.channel === 'sms') {
          setSmsText((latest.components as { text?: string })?.text ?? '');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load template');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isNew, params.id]);

  async function saveVersion(components: Record<string, unknown>, extra?: { designJson?: unknown; exportHtml?: string; exportText?: string }) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (isNew) {
        if (!name.trim()) throw new Error('Name is required');
        if (!channel) throw new Error('Channel is required');
        const res = await fetch('/api/broadcast/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel, name, components, ...extra }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create template');
        router.push(`/admin/broadcast/templates/${data.template.id}`);
        return;
      }

      const res = await fetch(`/api/broadcast/templates/${template!.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ components, ...extra }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save version');
      setNotice(`Saved as version ${data.version.versionNumber}`);
      setVersions((prev) => [data.version, ...prev]);
      setTemplate((prev) => (prev ? { ...prev, currentDraftVersionId: data.version.id } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function publishVersion(versionId: number) {
    if (!template) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/broadcast/templates/${template.id}/versions/${versionId}/publish`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to publish');
      setTemplate(data.template);
      setNotice(`Version ${data.version.versionNumber} published (status: ${data.template.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-4 text-sm text-[var(--cmg-muted)]">Loading…</div>;

  const smsEstimate = channel === 'sms' && smsText ? estimateSmsSegments(smsText) : null;

  return (
    <div className="flex flex-col gap-4 p-3 lg:p-4">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--cmg-ink)]">{isNew ? 'New template' : name}</h1>
        <p className="text-sm text-[var(--cmg-muted)]">
          {isNew ? 'Choose a channel and compose your template.' : `${channel?.toUpperCase()} · ${template?.status}`}
        </p>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--cmg-red)]">{error}</p>}
      {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

      {isNew && (
        <Card>
          <CardHeader><CardTitle className="text-base">Template details</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome Email" />
            </label>
            <label className="flex w-48 flex-col gap-1 text-sm font-medium">
              Channel
              <Select value={channel ?? undefined} onValueChange={(value) => setChannel(value as Channel)}>
                <SelectTrigger><SelectValue placeholder="Choose channel" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </CardContent>
        </Card>
      )}

      {channel === 'email' && (
        <Card>
          <CardContent className="pt-6">
            <EmailTemplateEditor
              initialSubject={(draftVersion?.components as { subject?: string })?.subject ?? ''}
              initialPreheader={(draftVersion?.components as { preheader?: string })?.preheader ?? ''}
              initialDesign={draftVersion?.designJson ?? null}
              saving={saving}
              onSave={(result: EmailTemplateSaveResult) =>
                saveVersion(
                  { subject: result.subject, preheader: result.preheader || undefined, designJson: result.designJson },
                  { designJson: result.designJson, exportHtml: result.exportHtml, exportText: result.exportText }
                )
              }
            />
          </CardContent>
        </Card>
      )}

      {channel === 'whatsapp' && (
        <Card>
          <CardHeader><CardTitle className="text-base">WhatsApp template</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Body (use {'{{1}}'}, {'{{2}}'}… for variables — Meta&apos;s positional format)
              <textarea
                className="min-h-[120px] w-full rounded-md border border-[var(--cmg-border)] px-3 py-2 text-sm"
                value={whatsappBody}
                onChange={(e) => setWhatsappBody(e.target.value)}
                maxLength={1024}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Footer (optional, max 60 chars)
              <Input value={whatsappFooter} onChange={(e) => setWhatsappFooter(e.target.value)} maxLength={60} />
            </label>
            <div className="flex justify-end">
              <Button
                disabled={saving || !whatsappBody.trim()}
                onClick={() => saveVersion({ body: { text: whatsappBody }, ...(whatsappFooter ? { footer: { text: whatsappFooter } } : {}) })}
              >
                {saving ? 'Saving…' : 'Save version'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {channel === 'sms' && (
        <Card>
          <CardHeader><CardTitle className="text-base">SMS template</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <textarea
              className="min-h-[100px] w-full rounded-md border border-[var(--cmg-border)] px-3 py-2 text-sm"
              value={smsText}
              onChange={(e) => setSmsText(e.target.value)}
              maxLength={1600}
              placeholder="e.g. Hi {{first_name}}, your OTP is {{otp}}"
            />
            {smsEstimate && (
              <p className="text-xs text-[var(--cmg-muted)]">
                {smsEstimate.encoding} · {smsEstimate.length} chars · {smsEstimate.segments} segment{smsEstimate.segments === 1 ? '' : 's'}
              </p>
            )}
            <div className="flex justify-end">
              <Button disabled={saving || !smsText.trim()} onClick={() => saveVersion({ text: smsText })}>
                {saving ? 'Saving…' : 'Save version'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isNew && versions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Version history</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--cmg-border)] text-left text-[var(--cmg-muted)]">
                  <th className="py-2 pr-4 font-medium">Version</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Created</th>
                  <th className="py-2 pr-4 font-medium" />
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.id} className="border-b border-[var(--cmg-border)]/50 last:border-0">
                    <td className="py-2 pr-4">v{version.versionNumber}</td>
                    <td className="py-2 pr-4">{version.isPublished ? 'Published' : 'Draft'}</td>
                    <td className="py-2 pr-4 text-[var(--cmg-muted)]">{new Date(version.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-4">
                      {!version.isPublished && (
                        <Button size="sm" variant="outline" disabled={saving} onClick={() => publishVersion(version.id)}>
                          Publish
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
