'use client';

import { useState, useEffect } from 'react';
import { uploadFileToBlob } from '@/lib/uploadToBlob';
import { Upload, CheckCircle, Clock, AlertCircle, FileSignature, ChevronRight, ChevronLeft } from 'lucide-react';

export default function SignedAgreementStage({ lead, data, setData, opportunityId, uploadedBy, complianceStatus, onSubmitCompliance, onNext, onPrevious }: any) {
  const [uploading, setUploading] = useState(false);
  const [submittingCompliance, setSubmittingCompliance] = useState(false);
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);

  const handleFileSelect = async (file?: File) => {
    if (!file) return;
    if (!opportunityId) {
      window.toast.warning('Opportunity not yet created. Please complete the agreement stage first.');
      return;
    }
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const blob = await uploadFileToBlob(file, `opportunity-documents/${opportunityId}/signed_agreement/${Date.now()}_${safeName}`);

      const res = await fetch('/api/opportunity-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opportunityId,
          documentType: 'signed_agreement',
          documentName: file.name,
          fileName: safeName,
          filePath: blob.url,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
          category: 'signed_agreement',
          status: 'uploaded',
          required: true,
          uploadedBy: uploadedBy || 1,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      const result = await res.json();
      setData({
        ...data,
        documentUrl: result.filePath || blob.url,
        uploadedTocrm: true,
      });
    } catch (err) {
      window.toast.error(`Failed to upload signed agreement: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = Boolean(data.documentUrl && data.uploadedTocrm && data.clientSignature && data.signatureDate);

  useEffect(() => {
    if (!canSubmit) return;
    if (!onSubmitCompliance) return;
    if (complianceStatus === 'pending' || complianceStatus === 'approved') return;
    if (submittedUrl === data.documentUrl) return;

    let cancelled = false;
    (async () => {
      setSubmittingCompliance(true);
      try {
        await onSubmitCompliance();
        if (!cancelled) setSubmittedUrl(data.documentUrl);
      } catch (error) {
        console.error('Error submitting signed agreement for compliance:', error);
        if (!cancelled) {
          window.toast.error(error instanceof Error ? error.message : 'Failed to submit signed agreement for compliance review');
        }
      } finally {
        if (!cancelled) setSubmittingCompliance(false);
      }
    })();

    return () => { cancelled = true; };
  }, [canSubmit, complianceStatus, data.documentUrl, onSubmitCompliance, submittedUrl]);

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <FileSignature className="mr-3 text-blue-600" size={28} />
        <div>
          <h3 className="text-2xl font-bold text-gray-900">Signed Agreement Upload</h3>
          <p className="text-gray-600 text-sm">Upload client-signed agreement document</p>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center">
          <AlertCircle className="mr-2 text-blue-600" size={20} />
          <span className="text-sm text-blue-800">Once uploaded with signature details, the signed agreement will be automatically sent to compliance for review.</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Client Signature</label>
          <input
            type="text"
            value={data.clientSignature}
            onChange={(e) => setData({ ...data, clientSignature: e.target.value })}
            className="w-full p-3 border rounded-lg"
            placeholder="Enter client signature"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Signature Date</label>
          <input
            type="date"
            value={data.signatureDate}
            onChange={(e) => setData({ ...data, signatureDate: e.target.value })}
            className="w-full p-3 border rounded-lg"
          />
        </div>
      </div>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
        <FileSignature className="mx-auto text-gray-400 mb-3" size={40} />
        {data.documentUrl ? (
          <div className="flex items-center justify-center gap-2 mb-3">
            <CheckCircle className="text-green-600" size={20} />
            <span className="text-sm text-green-800 font-medium">
              Uploaded: {data.documentUrl.split('/').pop()}
            </span>
          </div>
        ) : (
          <p className="text-gray-600 mb-3 text-sm">
            {uploading ? 'Uploading…' : 'Upload the signed agreement document (PDF, DOCX, JPG)'}
          </p>
        )}
        <label className={`inline-flex px-5 py-2 rounded-lg cursor-pointer text-sm font-medium ${
          uploading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
        } text-white`}>
          <Upload className="mr-2" size={18} />
          {uploading ? 'Uploading…' : data.documentUrl ? 'Replace File' : 'Choose File'}
          <input
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            className="hidden"
            disabled={uploading}
            onChange={(e) => handleFileSelect(e.target.files?.[0])}
          />
        </label>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Compliance status</span>
        <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${
          complianceStatus === 'approved' ? 'bg-green-100 text-green-700' :
          complianceStatus === 'rejected' ? 'bg-red-100 text-red-700' :
          complianceStatus === 'pending' ? 'bg-yellow-100 text-yellow-700' :
          'bg-gray-100 text-gray-700'
        }`}>
          {complianceStatus.replace('_', ' ')}
        </span>
      </div>
      {submittingCompliance && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800 flex items-center gap-2">
          <Clock size={16} />
          Sending signed agreement to compliance manager...
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onPrevious}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 flex items-center font-medium"
        >
          <ChevronLeft className="mr-2" size={20} />
          Back to Agreement
        </button>
        <button
          onClick={onNext}
          disabled={!canSubmit}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center font-medium"
        >
          Submit for Compliance Review
          <ChevronRight className="ml-2" size={20} />
        </button>
      </div>
    </div>
  );
}
