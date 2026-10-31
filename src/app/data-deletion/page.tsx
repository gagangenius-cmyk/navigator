import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Data Deletion | Global Navigator CRM' };

const CONTACT_EMAIL = 'privacy@navigatorcrm.online';

export default function DataDeletionPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-7 text-gray-800">
      <h1 className="mb-2 text-3xl font-semibold">User Data Deletion</h1>
      <p className="mb-8 text-gray-500">Global Navigator CRM (navigatorcrm.online)</p>

      <p>
        If you submitted a Facebook/Instagram lead form or contacted us on WhatsApp and want your personal data
        removed from our systems, follow these steps:
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-6">
        <li>
          Email <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with the subject
          &quot;Data deletion request&quot;.
        </li>
        <li>Include the name and phone number or email address you used when you contacted us.</li>
        <li>We will confirm your request and delete your data within 30 days.</li>
      </ol>

      <p className="mt-6">
        Deletion removes your lead record, contact details, form answers and message history from our CRM. Some
        information may be kept where we are legally required to retain it. See our{' '}
        <a className="underline" href="/privacy">Privacy Policy</a>.
      </p>
    </main>
  );
}
