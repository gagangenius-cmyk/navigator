import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireClientAuth, isClientAuthError } from '@/lib/clientApiAuth';
import { ClientPortalService } from '@/services/client-portal-service';
import { classifyDocumentMatch } from '@/lib/documentClassification';
import { notifyUser } from '@/lib/notify';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

// Fire-and-forget: never awaited by the request handler, never blocks or
// fails the upload. Only runs for image types - PDF/other document formats
// aren't image content blocks the vision API can read the same way, and
// that's most of what this checklist actually collects anyway (bank
// statements, forms), so this is scoped to what it can actually judge.
function checkDocumentInBackground(input: {
  documentId: string;
  leadId: number;
  fileBuffer: Buffer;
  mediaType: string;
  documentLabel: string;
}): void {
  if (!IMAGE_MIME_TYPES.has(input.mediaType)) return;
  void (async () => {
    try {
      const result = await classifyDocumentMatch({
        imageBase64: input.fileBuffer.toString('base64'),
        mediaType: input.mediaType,
        expectedLabel: input.documentLabel,
      });
      if (!result) return;

      await ClientPortalService.recordDocumentCheck(input.documentId, result.matches ? 'match' : 'mismatch', result.note);

      if (!result.matches) {
        const [lead] = await sequelize.query<{ assignTo: number | null; Counsilor: number | null; fname: string; lname: string }>(
          `SELECT assignTo, Counsilor, fname, lname FROM crm_forum_leads WHERE id = :leadId LIMIT 1`,
          { replacements: { leadId: input.leadId }, type: QueryTypes.SELECT }
        );
        const ownerId = lead?.Counsilor || lead?.assignTo;
        if (ownerId) {
          const clientName = lead ? `${lead.fname || ''} ${lead.lname || ''}`.trim() : `Lead #${input.leadId}`;
          await notifyUser({
            userId: ownerId,
            type: 'system',
            title: 'Uploaded document may not match',
            message: `${clientName} uploaded a file for "${input.documentLabel}" that doesn't look right (AI check, ${result.confidence}% confidence): ${result.note}`,
            priority: 'medium',
            link: `/admin/leads/${input.leadId}/edit`,
            relatedId: input.leadId,
            relatedType: 'lead',
          });
        }
      }
    } catch (error) {
      console.error(`[Document AI Check] Unhandled error for document ${input.documentId}:`, error);
    }
  })();
}

export async function POST(request: NextRequest) {
  const client = requireClientAuth(request);
  if (isClientAuthError(client)) return client;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const opportunityId = Number(formData.get('opportunityId'));
    const checklistKey = String(formData.get('checklistKey') || '');

    if (!file || !opportunityId || !checklistKey) {
      return NextResponse.json({ error: 'file, opportunityId, and checklistKey are required' }, { status: 400 });
    }

    await ClientPortalService.getChecklist(client.leadId);

    // Only checklist rows seeded from verified/won services can receive uploads.
    const [document] = await sequelize.query<{ document_id: string; document_label: string }>(
      `SELECT document_id, document_label
       FROM crm_client_documents
       WHERE lead_id = :leadId AND opportunity_id = :opportunityId AND checklist_key = :checklistKey
       LIMIT 1`,
      { replacements: { opportunityId, checklistKey, leadId: client.leadId }, type: QueryTypes.SELECT }
    );
    if (!document) {
      return NextResponse.json({ error: 'That document is not part of your verified checklist' }, { status: 403 });
    }

    // recordUpload() below UPDATEs a fixed checklist row rather than
    // inserting, so a resubmit can't create a duplicate row - but it would
    // still waste a redundant blob upload on a double-click, so short-circuit
    // that here instead.
    const [justUploaded] = await sequelize.query<{ document_id: string }>(
      `SELECT document_id FROM crm_client_documents
       WHERE lead_id = :leadId AND opportunity_id = :opportunityId AND checklist_key = :checklistKey
         AND uploaded_at >= (NOW() - INTERVAL 60 SECOND)
       LIMIT 1`,
      { replacements: { opportunityId, checklistKey, leadId: client.leadId }, type: QueryTypes.SELECT }
    );
    if (justUploaded) {
      return NextResponse.json({ error: 'This file was already uploaded a moment ago.' }, { status: 409 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = await put(`client-portal-documents/${client.leadId}/${checklistKey}/${Date.now()}_${safeName}`, file, {
      access: 'public',
      addRandomSuffix: true,
    });

    const result = await ClientPortalService.recordUpload({
      leadId: client.leadId,
      opportunityId,
      checklistKey,
      fileUrl: blob.url,
      fileName: file.name,
    });

    const savedDocument = result[0] as { document_id: string } | undefined;
    if (savedDocument?.document_id) {
      checkDocumentInBackground({
        documentId: savedDocument.document_id,
        leadId: client.leadId,
        fileBuffer: Buffer.from(await file.arrayBuffer()),
        mediaType: file.type,
        documentLabel: document.document_label,
      });
    }

    return NextResponse.json({ document: savedDocument || null }, { status: 201 });
  } catch (error) {
    console.error('Client portal upload error:', error);
    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 });
  }
}
