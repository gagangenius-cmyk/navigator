'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getLeadBranchDetails } from '@/lib/receiptTemplate';
import { Download, CheckCircle, FileText, Mail, KeyRound } from 'lucide-react';

function ReadonlyDetail({ label, value, placeholder = '' }: { label: string; value?: string | null; placeholder?: string }) {
  return (
    <div>
      <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-gray-500">{label}</label>
      <div className={`min-h-[52px] rounded-lg border border-gray-200 bg-white px-4 py-3 text-base ${value ? 'text-gray-900' : 'text-gray-400'}`}>
        {value || placeholder}
      </div>
    </div>
  );
}

export default function ClosedStage({ lead, leadId, prospectData, quotationData, paymentData, currencyCode = 'AED' }: any) {
  const { user } = useAuth();
  const [generatingCredentials, setGeneratingCredentials] = useState(false);
  const [portalMessage, setPortalMessage] = useState('');
  const [portalCredentials, setPortalCredentials] = useState<{
    loginUrl: string;
    username: string;
    temporaryPassword: string;
    generatedAt?: string | null;
  } | null>(null);

  const clientName = [lead?.fname, lead?.lname].filter(Boolean).join(' ').trim() || lead?.name || 'Client';
  const clientEmail = lead?.email || portalCredentials?.username || '';
  const branchDetails = getLeadBranchDetails(lead as any);
  const branchOffice = branchDetails.companyName || 'Global Navigator LLC FZ';
  const counselorName = user?.name || '';
  const emailSubject = `Welcome to Global Navigator, ${clientName} - Your Client Portal is Ready`;
  const emailBody = [
    `Dear ${clientName},`,
    '',
    "Welcome to Global Navigator! We're glad to have you on board, and we're committed to making your immigration journey as smooth and transparent as possible.",
    '',
    "To help you stay updated at every step, we've set up your Client Portal - a single place to track your case status, view and upload documents, and stay in touch with your counselor.",
    '',
    'Here are your login details:',
    '',
    `Login URL: ${portalCredentials?.loginUrl || ''}`,
    `Username: ${portalCredentials?.username || clientEmail}`,
    `Temporary Password: ${portalCredentials?.temporaryPassword || ''}`,
    '',
    "For security, please log in and change your password as soon as possible. If you run into any trouble accessing the portal, just reply to this email and we'll help you right away.",
    '',
    'Thank you for choosing Global Navigator. We look forward to supporting you through every stage of your journey.',
    '',
    'Warm regards,',
    'The Global Navigator Team',
  ].join('\n');
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${emailSubject}\n\n${emailBody}`);
      setPortalMessage('Email content copied.');
    } catch {
      setPortalMessage('Could not copy email content.');
    }
  };
  const openGmailCompose = () => {
    const url = new URL('https://mail.google.com/mail/');
    url.searchParams.set('view', 'cm');
    url.searchParams.set('fs', '1');
    url.searchParams.set('to', clientEmail);
    url.searchParams.set('su', emailSubject);
    url.searchParams.set('body', emailBody);
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  };
  const generateClientPortal = async () => {
    setGeneratingCredentials(true);
    setPortalMessage('');
    try {
      const res = await fetch(`/api/admin/clients/${leadId}/credentials`, { method: 'POST' });
      const json = await res.json();
      if (res.ok) {
        setPortalCredentials({
          loginUrl: json.loginUrl || `${window.location.origin}/clientportal/login`,
          username: json.username || json.email,
          temporaryPassword: json.temporaryPassword || '',
          generatedAt: json.generatedAt || null,
        });
        setPortalMessage('Client portal details are ready.');
      } else {
        setPortalMessage(json.error || 'Failed to generate credentials');
      }
    } catch {
      setPortalMessage('Failed to generate credentials');
    } finally {
      setGeneratingCredentials(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/clients/${leadId}/credentials`)
      .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
      .then(({ ok, json }) => {
        if (cancelled || !ok || !json.credentials) return;
        setPortalCredentials({
          loginUrl: json.credentials.loginUrl || `${window.location.origin}/clientportal/login`,
          username: json.credentials.username || json.credentials.email,
          temporaryPassword: json.credentials.temporaryPassword || '',
          generatedAt: json.credentials.generatedAt || null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [leadId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center mb-6">
        <CheckCircle className="mr-3 text-green-600" size={28} />
        <div>
          <h3 className="text-2xl font-bold text-gray-900">Opportunity Closed - Won!</h3>
          <p className="text-gray-600 text-sm">Lead successfully converted to customer</p>
        </div>
      </div>

      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <h4 className="font-semibold text-lg mb-4 text-green-900">Success Summary</h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium">Opportunity:</span> {prospectData.opportunityName}
          </div>
          <div>
            <span className="font-medium">Total Value:</span> {currencyCode} {quotationData.total.toFixed(2)}
          </div>
          <div>
            <span className="font-medium">Amount Paid:</span> {currencyCode} {paymentData.paidAmount.toFixed(2)}
          </div>
          <div>
            <span className="font-medium">Closed Date:</span> {new Date().toLocaleDateString()}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h4 className="font-semibold text-lg mb-4 text-gray-900">Process Timeline</h4>
        <div className="space-y-2 text-sm">
          {[
            'Prospect → Quotation',
            'Quotation → Payment',
            'Payment → Documents',
            'Documents → Agreement',
            'Agreement → Signed Agreement',
            'Signed Agreement → Retained',
            'Retained → Closed'
          ].map((step, index) => (
            <div key={index} className="flex items-center">
              <CheckCircle className="mr-2 text-green-600" size={16} />
              <span className="text-green-700">{step} ✓</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-2xl font-bold text-gray-900">Welcome Email - Client Portal Handoff</h4>
            <p className="mt-1 text-sm text-gray-500">Generate once, review the client portal details, then copy or send.</p>
          </div>
          {!portalCredentials?.temporaryPassword && (
            <button
              onClick={generateClientPortal}
              disabled={generatingCredentials}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <KeyRound className="mr-2 h-4 w-4" />
              {generatingCredentials ? 'Generating...' : 'Generate Client Portal'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <ReadonlyDetail label="Client Name" value={clientName} />
          <ReadonlyDetail label="Client Email" value={clientEmail} />
          <ReadonlyDetail label="Login URL" value={portalCredentials?.loginUrl || ''} />
          <ReadonlyDetail label="Username" value={portalCredentials?.username || clientEmail} />
          <ReadonlyDetail label="Temporary Password" value={portalCredentials?.temporaryPassword || ''} />
          <ReadonlyDetail label="Counselor Name" value={counselorName} placeholder="Your name" />
          <div className="md:col-span-2">
            <ReadonlyDetail label="Branch / Office" value={branchOffice} />
          </div>
        </div>
        {portalMessage && <p className="mt-4 text-sm text-gray-600">{portalMessage}</p>}
      </div>

      {portalCredentials && (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 text-gray-900">
            <p className="text-base text-gray-500"><strong className="text-gray-900">Subject:</strong> {emailSubject}</p>
            <div className="my-4 border-t border-dashed border-gray-300" />
            <div className="space-y-5 whitespace-pre-line text-base leading-8">
              <p>Dear {clientName},</p>
              <p>{`Welcome to Global Navigator! We're glad to have you on board, and we're committed to making your immigration journey as smooth and transparent as possible.`}</p>
              <p>{`To help you stay updated at every step, we've set up your Client Portal - a single place to track your case status, view and upload documents, and stay in touch with your counselor.`}</p>
              <p>Here are your login details:</p>
              <p>
                Login URL: {portalCredentials.loginUrl}<br />
                Username: <span className="rounded bg-green-100 px-1 font-semibold text-green-800">{portalCredentials.username}</span><br />
                Temporary Password: <span className="rounded bg-green-100 px-1 font-semibold text-green-800">{portalCredentials.temporaryPassword}</span>
              </p>
              <p>{`For security, please log in and change your password as soon as possible. If you run into any trouble accessing the portal, just reply to this email and we'll help you right away.`}</p>
              <p>Thank you for choosing Global Navigator. We look forward to supporting you through every stage of your journey.</p>
              <p>Warm regards,<br />The Global Navigator Team</p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={openGmailCompose}
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Mail className="mr-2 h-4 w-4" />
              Send via Gmail
            </button>
            <button
              onClick={copyEmail}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50"
            >
              <FileText className="mr-2 h-4 w-4" />
              Copy Email
            </button>
          </div>
          <p className="mt-3 text-sm text-gray-500">Send via Gmail opens a pre-filled compose window in your logged-in Gmail account. Copy Email copies the subject and body as plain text.</p>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center font-medium">
          <Download className="mr-2" size={20} />
          Generate Report
        </button>
        <button
          onClick={() => window.location.href = '/admin/leads'}
          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center font-medium"
        >
          <CheckCircle className="mr-2" size={20} />
          Back to Leads
        </button>
      </div>
    </div>
  );
}
