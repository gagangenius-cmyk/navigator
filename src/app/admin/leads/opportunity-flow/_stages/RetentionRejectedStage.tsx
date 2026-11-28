'use client';

import { useState } from 'react';
import { Upload, CheckCircle, XCircle, Clock, AlertCircle, KeyRound } from 'lucide-react';

export default function RetentionRejectedStage({ lead, leadId, data, onResubmit }: any) {
  const isApproved = data.agreementComplianceStatus === 'approved';
  const isPending = data.agreementComplianceStatus === 'pending' || data.agreementComplianceStatus === 'not_submitted';
  const statusLabel = isApproved ? 'Approved' : isPending ? 'Pending' : 'Rejected';
  const StatusIcon = isApproved ? CheckCircle : isPending ? Clock : XCircle;
  const [generatingCredentials, setGeneratingCredentials] = useState(false);
  const [portalMessage, setPortalMessage] = useState('');
  const [portalCredentials, setPortalCredentials] = useState<{
    loginUrl: string;
    username: string;
    temporaryPassword: string;
  } | null>(null);
  const tone = isApproved
    ? {
        icon: 'text-green-600',
        panel: 'bg-green-50 border-green-200',
        heading: 'text-green-900',
        accent: 'border-green-600',
        action: 'Approved By',
        date: 'Approval Date',
        notesTitle: 'Review Notes',
        subtitle: 'Agreement was approved by compliance manager',
      }
    : isPending
      ? {
          icon: 'text-yellow-600',
          panel: 'bg-yellow-50 border-yellow-200',
          heading: 'text-yellow-900',
          accent: 'border-yellow-600',
          action: 'Review By',
          date: 'Review Date',
          notesTitle: 'Review Notes',
          subtitle: 'Agreement is waiting for compliance manager review',
        }
      : {
          icon: 'text-red-600',
          panel: 'bg-red-50 border-red-200',
          heading: 'text-red-900',
          accent: 'border-red-600',
          action: 'Rejected By',
          date: 'Rejection Date',
          notesTitle: 'Rejection Reason',
          subtitle: 'Agreement was rejected by compliance manager',
        };

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <StatusIcon className={`mr-3 ${tone.icon}`} size={28} />
        <div>
          <h3 className="text-2xl font-bold text-gray-900">Retention Review {statusLabel}</h3>
          <p className="text-gray-600 text-sm">{tone.subtitle}</p>
        </div>
      </div>

      <div className={`${tone.panel} border rounded-lg p-6`}>
        <h4 className={`font-semibold text-lg mb-4 ${tone.heading}`}>Retention Review Details</h4>
        <div className="space-y-2 text-sm">
          <div className="flex items-center">
            <StatusIcon className={`mr-2 ${tone.icon}`} size={16} />
            <span><strong>{tone.action}:</strong> {data.complianceManager || 'Compliance Manager'}</span>
          </div>
          <div className="flex items-center">
            <Clock className={`mr-2 ${tone.icon}`} size={16} />
            <span><strong>{tone.date}:</strong> {data.reviewDate || new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h4 className="font-semibold text-lg mb-4 text-gray-900">{tone.notesTitle}</h4>
        <div className={`p-4 bg-gray-50 rounded-lg border-l-4 ${tone.accent}`}>
          <p className="text-sm">{data.reviewNotes || (isApproved ? 'Approved' : isPending ? 'Compliance review is still pending.' : 'The submitted agreement requires modifications before approval.')}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="font-semibold text-lg text-gray-900">Client Portal</h4>
            <p className="text-sm text-gray-600">Generate and email portal login credentials for this client.</p>
          </div>
          <button
            onClick={async () => {
              setGeneratingCredentials(true);
              setPortalMessage('');
              setPortalCredentials(null);
              try {
                const res = await fetch(`/api/admin/clients/${leadId}/credentials`, { method: 'POST' });
                const json = await res.json();
                if (res.ok) {
                  setPortalMessage(`Portal credentials emailed to ${json.email}.`);
                  setPortalCredentials({
                    loginUrl: json.loginUrl || `${window.location.origin}/clientportal/login`,
                    username: json.username || json.email,
                    temporaryPassword: json.temporaryPassword || '',
                  });
                } else {
                  setPortalMessage(json.error || 'Failed to generate credentials');
                }
              } catch {
                setPortalMessage('Failed to generate credentials');
              } finally {
                setGeneratingCredentials(false);
              }
            }}
            disabled={generatingCredentials}
            className="inline-flex items-center justify-center rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            <KeyRound className="mr-2 h-4 w-4" />
            {generatingCredentials ? 'Generating...' : 'Generate Client Portal Credentials'}
          </button>
        </div>
        {portalMessage && <p className="mt-3 text-sm text-gray-600">{portalMessage}</p>}
        {portalCredentials && (
          <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3">
            <div className="min-w-0">
              <p className="font-medium text-slate-500">Login URL</p>
              <a
                href={portalCredentials.loginUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-semibold text-blue-700 hover:text-blue-800"
              >
                {portalCredentials.loginUrl}
              </a>
            </div>
            <div className="min-w-0">
              <p className="font-medium text-slate-500">Username</p>
              <p className="truncate font-semibold text-slate-900">{portalCredentials.username}</p>
            </div>
            <div className="min-w-0">
              <p className="font-medium text-slate-500">Temporary Password</p>
              <p className="truncate font-semibold text-slate-900">{portalCredentials.temporaryPassword}</p>
            </div>
          </div>
        )}
      </div>

      {!isApproved && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h4 className="font-semibold text-lg mb-4 text-yellow-900">Required Actions</h4>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center">
            <AlertCircle className="mr-2 text-yellow-600" size={16} />
            Review and update agreement terms
          </li>
          <li className="flex items-center">
            <AlertCircle className="mr-2 text-yellow-600" size={16} />
            Address compliance manager feedback
          </li>
          <li className="flex items-center">
            <AlertCircle className="mr-2 text-yellow-600" size={16} />
            Resubmit for review
          </li>
        </ul>
        </div>
      )}

      {!isApproved && (
        <div className="flex justify-end">
        <button
          onClick={onResubmit}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center font-medium"
        >
          <Upload className="mr-2" size={20} />
          Resubmit for Review
        </button>
        </div>
      )}
    </div>
  );
}
