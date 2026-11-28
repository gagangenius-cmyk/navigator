'use client';

import { useState, useEffect } from 'react';
import { uploadFileToBlob } from '@/lib/uploadToBlob';
import { CheckCircle } from 'lucide-react';

export default function DocumentsStage({ lead, leadId, onLeadUpdated, data, setData, opportunityId: initialOpportunityId, onEnsureOpportunity, uploadedBy, paymentProofFile, onNext, onPrevious }: any) {
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, 'idle' | 'uploading' | 'done' | 'error'>>({});

  const mandatoryDocs = [
    { key: 'idProof', label: 'ID Proof (Mandatory)', category: 'id_proof' },
    { key: 'passportCopy', label: 'Passport Copy (Mandatory)', category: 'passport' },
    { key: 'counsellorSheet', label: 'Counsellor Sheet (Mandatory)', category: 'counsellor_sheet' },
  ] as const;

  const optionalDocs: { key: string; label: string; category: string }[] = [];

  // Either freshly selected in this session (File objects) or already uploaded
  // server-side in an earlier session (persisted allMandatoryDocsUploaded flag,
  // restored by the wizard's mount-time hydration effect).
  const freshlyUploaded = mandatoryDocs.every(({ key }) => data[key] instanceof File);
  const hasPassportNumber = Boolean(String(data.passportNumber || '').trim());
  const hasClientActualName = Boolean(String(data.clientActualName || '').trim());
  const allMandatoryUploaded = (freshlyUploaded || data.allMandatoryDocsUploaded) && hasPassportNumber && hasClientActualName;

  useEffect(() => {
    if (allMandatoryUploaded !== data.allMandatoryDocsUploaded) {
      setData({ ...data, allMandatoryDocsUploaded: allMandatoryUploaded });
    }
  }, [allMandatoryUploaded]);

  const uploadFileToServer = async (file: File, category: string, oppId: number): Promise<string | null> => {
    // Upload straight from the browser to Vercel Blob (bypasses the ~4.5MB
    // serverless function body limit), then record the metadata separately.
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = await uploadFileToBlob(file, `opportunity-documents/${oppId}/${category}/${Date.now()}_${safeName}`);

    const res = await fetch('/api/opportunity-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        opportunityId: oppId,
        documentType: category,
        documentName: file.name,
        fileName: safeName,
        filePath: blob.url,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        category,
        status: 'uploaded',
        required: true,
        uploadedBy: uploadedBy || 1,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Upload failed for ${file.name}`);
    }
    const result = await res.json();
    return result.filePath || blob.url;
  };

  const handleSave = async () => {
    if (!allMandatoryUploaded) return;
    setSaving(true);
    try {
      // Passport number and client actual name live on the lead record itself
      // (crm_forum_leads.id_number / client_actual_name), not on an
      // opportunity-document row, so they're saved via the same lead-update
      // endpoint the Edit Lead page uses rather than /api/opportunity-documents.
      if (leadId) {
        const leadUpdateRes = await fetch(`/api/leads/${leadId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passportNumber: data.passportNumber, clientActualName: data.clientActualName }),
        });
        if (!leadUpdateRes.ok) {
          const err = await leadUpdateRes.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to save passport number and client actual name');
        }
        // Keep the wizard's lead state in sync so the client's actual name is
        // immediately available to the Agreement/Signed Agreement stages and
        // any receipt printed afterward, without needing a full page reload.
        const updatedLead = await leadUpdateRes.json();
        onLeadUpdated?.(updatedLead);
      }

      // Ensure we have an opportunity ID — create one if missing
      let oppId: number | null = initialOpportunityId || null;
      if (!oppId && onEnsureOpportunity) {
        try {
          oppId = await onEnsureOpportunity();
        } catch (err) {
          console.error('Could not ensure opportunity for document upload:', err);
        }
      }

      if (!oppId) {
        // Nothing durable to attach these files to yet. The selected File
        // objects only exist in this component's local state - they can't
        // survive a page reload - so claiming "saved" and advancing here
        // used to let the user navigate away believing the documents were
        // safe when they were never actually uploaded anywhere.
        window.toast.error('Documents could not be saved — no opportunity exists for this lead yet. Complete the Payment stage first, then try again.');
        return;
      }

      // Upload mandatory documents (ID proof, passport)
      for (const { key, category } of mandatoryDocs) {
        const file = data[key];
        if (file instanceof File) {
          setUploadProgress(p => ({ ...p, [key]: 'uploading' }));
          try {
            await uploadFileToServer(file, category, oppId as number);
            setUploadProgress(p => ({ ...p, [key]: 'done' }));
          } catch (err) {
            setUploadProgress(p => ({ ...p, [key]: 'error' }));
            throw err;
          }
        }
      }
      // Also upload proof of payment if provided from payment stage
      if (paymentProofFile instanceof File) {
        setUploadProgress(p => ({ ...p, proofOfPayment: 'uploading' }));
        try {
          await uploadFileToServer(paymentProofFile, 'proof_of_payment', oppId as number);
          setUploadProgress(p => ({ ...p, proofOfPayment: 'done' }));
        } catch (err) {
          console.warn('Proof of payment upload failed (non-blocking):', err);
          setUploadProgress(p => ({ ...p, proofOfPayment: 'error' }));
        }
      }

      window.toast.success('Documents saved successfully!');
      onNext();
    } catch (error) {
      console.error('Error saving documents:', error);
      window.toast.error(`Error saving documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Documents & Information</h3>
        {!initialOpportunityId && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            Opportunity will be created automatically when you save documents.
          </div>
        )}
        {data.allMandatoryDocsUploaded && !freshlyUploaded && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
            Mandatory documents were already uploaded in a previous session. You can continue, or re-select a file below to replace one.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {mandatoryDocs.map(({ key, label, category }) => {
            const uploadedUrl = data.uploadedDocUrls?.[category];
            const showUploadedLink = !(data[key] instanceof File) && Boolean(uploadedUrl);
            return (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {label}{' '}
                {uploadProgress[key] === 'done' && <span className="text-green-600 text-xs">(uploaded ✓)</span>}
                {uploadProgress[key] === 'uploading' && <span className="text-blue-600 text-xs">(uploading...)</span>}
                {uploadProgress[key] === 'error' && <span className="text-red-600 text-xs">(upload failed)</span>}
                {!uploadProgress[key] && data[key] instanceof File && <span className="text-green-600 text-xs">(selected)</span>}
              </label>
              {showUploadedLink && (
                <div className="flex items-center gap-2 px-3 py-2 mb-2 bg-green-50 border border-green-200 rounded-lg">
                  <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                  <a
                    href={uploadedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-green-800 hover:text-green-900 hover:underline truncate flex-1"
                  >
                    View uploaded file
                  </a>
                </div>
              )}
              <input
                type="file"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setData({ ...data, [key]: file });
                  setUploadProgress(p => ({ ...p, [key]: 'idle' }));
                }}
              />
              {showUploadedLink && (
                <p className="text-xs text-gray-400 mt-1">Choosing a new file will replace the one above.</p>
              )}
            </div>
            );
          })}
          {optionalDocs.map(({ key, label }) => (
            <div key={key}>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {label} {data[key] instanceof File && <span className="text-green-600 text-xs">(selected)</span>}
              </label>
              <input
                type="file"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setData({ ...data, [key]: file });
                }}
              />
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Passport Number <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={data.passportNumber || ''}
              onChange={(e) => setData({ ...data, passportNumber: e.target.value })}
              placeholder="Enter passport number"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Client Actual Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={data.clientActualName || ''}
              onChange={(e) => setData({ ...data, clientActualName: e.target.value })}
              placeholder="Client's full legal name as it should appear on the agreement and receipt"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-md font-medium text-gray-900 mb-3">Additional Information</h4>
        <textarea
          className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          rows={4}
          placeholder="Enter any additional information or notes..."
          value={data.additionalInfo || ''}
          onChange={(e) => setData({...data, additionalInfo: e.target.value})}
        />
      </div>

      <div className="flex justify-between">
        <button
          onClick={onPrevious}
          className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Back to Accounts
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !allMandatoryUploaded}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save & Continue'}
        </button>
      </div>
    </div>
  );
}
