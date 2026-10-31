import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy | Global Navigator CRM' };

const CONTACT_EMAIL = 'privacy@navigatorcrm.online';

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-7 text-gray-800">
      <h1 className="mb-2 text-3xl font-semibold">Privacy Policy</h1>
      <p className="mb-8 text-gray-500">Global Navigator CRM (navigatorcrm.online)</p>

      <h2 className="mt-6 text-lg font-semibold">Information we collect</h2>
      <p>
        When you submit a Facebook or Instagram Lead Ad form, or message us on WhatsApp (including from a
        Click-to-WhatsApp ad), we receive the details you provide: name, phone number, email address, the
        answers to the form questions, and which ad or campaign you responded to.
      </p>

      <h2 className="mt-6 text-lg font-semibold">How we use it</h2>
      <p>
        We use this information to respond to your enquiry, provide the services you asked about, and keep a
        record of our communication with you. We do not sell your personal information.
      </p>

      <h2 className="mt-6 text-lg font-semibold">Sharing</h2>
      <p>
        Your information is shared only with our staff and the service providers that help us operate
        (for example Meta, which delivers the ads, forms and WhatsApp messages), and where required by law.
      </p>

      <h2 className="mt-6 text-lg font-semibold">Retention and deletion</h2>
      <p>
        We keep your information only as long as needed for the purposes above. You can ask us to delete it at
        any time; see <a className="underline" href="/data-deletion">how to request data deletion</a>.
      </p>

      <h2 className="mt-6 text-lg font-semibold">Contact</h2>
      <p>
        Questions about this policy: <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </main>
  );
}
