'use client';

import { useRef, useState, type RefAttributes } from 'react';
import dynamic from 'next/dynamic';
import type { EditorRef, EmailEditorProps } from 'react-email-editor';
import { Button } from '@/components/ui/button';

// Unlayer's editor runs entirely client-side (it mounts an iframe) - loading
// it during SSR would fail with no window/document, so it's dynamically
// imported with ssr: false, matching this repo's convention for other
// client-only-library wrappers. The explicit RefAttributes intersection is
// needed because next/dynamic's typing otherwise drops the forwardRef
// signature that react-email-editor's EmailEditor component relies on.
const EmailEditor = dynamic<EmailEditorProps & RefAttributes<EditorRef>>(
  () => import('react-email-editor').then((mod) => mod.EmailEditor),
  { ssr: false, loading: () => <div className="flex h-[600px] items-center justify-center text-sm text-[var(--cmg-muted)]">Loading email editor…</div> }
);

export interface EmailTemplateVariable {
  name: string;
  sample?: string;
}

export interface EmailTemplateSaveResult {
  subject: string;
  preheader: string;
  designJson: Record<string, unknown>;
  exportHtml: string;
  exportText: string;
}

interface EmailTemplateEditorProps {
  initialSubject?: string;
  initialPreheader?: string;
  initialDesign?: Record<string, unknown> | null;
  variables?: EmailTemplateVariable[];
  onSave: (result: EmailTemplateSaveResult) => Promise<void> | void;
  saving?: boolean;
}

// Unlayer needs a projectId to run un-branded/with full features - see
// docs/broadcast-architecture.md's "Unlayer licensing" note. Undefined
// (unset NEXT_PUBLIC_UNLAYER_PROJECT_ID) falls back to Unlayer's default
// embed, which still works for evaluation/internal use, just with Unlayer's
// own branding in the toolbar.
const projectIdEnv = process.env.NEXT_PUBLIC_UNLAYER_PROJECT_ID;
const projectId = projectIdEnv ? Number.parseInt(projectIdEnv, 10) : undefined;

export function EmailTemplateEditor({
  initialSubject = '',
  initialPreheader = '',
  initialDesign,
  variables = [],
  onSave,
  saving = false,
}: EmailTemplateEditorProps) {
  const editorRef = useRef<EditorRef>(null);
  const [subject, setSubject] = useState(initialSubject);
  const [preheader, setPreheader] = useState(initialPreheader);
  const [ready, setReady] = useState(false);

  const handleReady = () => {
    const unlayer = editorRef.current?.editor;
    if (!unlayer) return;

    if (variables.length > 0) {
      unlayer.setMergeTags(
        Object.fromEntries(
          variables.map((variable) => [
            variable.name,
            { name: variable.name, value: `{{${variable.name}}}`, sample: variable.sample ?? variable.name },
          ])
        )
      );
    }

    if (initialDesign) {
      unlayer.loadDesign(initialDesign as never);
    }
    setReady(true);
  };

  const handleSave = () => {
    const unlayer = editorRef.current?.editor;
    if (!unlayer) return;

    unlayer.saveDesign((design) => {
      unlayer.exportHtml((htmlResult) => {
        unlayer.exportPlainText((textResult) => {
          void onSave({
            subject,
            preheader,
            designJson: design as unknown as Record<string, unknown>,
            exportHtml: htmlResult.html,
            exportText: textResult.text,
          });
        });
      });
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium text-[var(--cmg-ink)]">
          Subject
          <input
            className="h-10 w-full rounded-md border border-[var(--cmg-border)] px-3 py-2 text-sm"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="e.g. Welcome to {{branch_name}}, {{first_name}}!"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-[var(--cmg-ink)]">
          Preheader (optional)
          <input
            className="h-10 w-full rounded-md border border-[var(--cmg-border)] px-3 py-2 text-sm"
            value={preheader}
            onChange={(event) => setPreheader(event.target.value)}
            placeholder="Preview text shown in the inbox list"
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--cmg-border)]">
        <EmailEditor
          ref={editorRef}
          minHeight={600}
          onReady={handleReady}
          options={{ projectId, displayMode: 'email' }}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={handleSave} disabled={!ready || saving || !subject.trim()}>
          {saving ? 'Saving…' : 'Save version'}
        </Button>
      </div>
    </div>
  );
}
