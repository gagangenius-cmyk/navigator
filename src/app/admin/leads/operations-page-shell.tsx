'use client';

import { Suspense, type ComponentType } from 'react';
import { useSearchParams } from 'next/navigation';

export type OperationsWizardProps = {
  opportunityId: number;
  leadId: number;
  clientName: string;
};

type OperationsPageShellProps = {
  Wizard: ComponentType<OperationsWizardProps>;
  /**
   * Full Tailwind class for the loading spinner (e.g. 'border-blue-600').
   * Must be a literal string at the call site so Tailwind's scanner keeps it.
   */
  spinnerClass?: string;
};

function OperationsPageContent({ Wizard }: Pick<OperationsPageShellProps, 'Wizard'>) {
  const searchParams = useSearchParams();
  const opportunityId = Number.parseInt(searchParams.get('opportunityId') ?? '', 10);
  const leadId = Number.parseInt(searchParams.get('leadId') ?? '', 10);
  const clientName = searchParams.get('clientName') || 'Client';

  if (!opportunityId || !leadId) {
    return (
      <div className="min-h-[60vh] bg-gray-50 flex items-center justify-center">
        <div className="text-center bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Error</h1>
          <p className="text-gray-600 mb-4">Missing required parameters.</p>
          <button
            onClick={() => (window.location.href = '/admin/leads')}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Leads
          </button>
        </div>
      </div>
    );
  }

  return <Wizard opportunityId={opportunityId} leadId={leadId} clientName={safeDecode(clientName)} />;
}

// decodeURIComponent throws URIError on a malformed escape (e.g. "%E0%A4%A"),
// which would crash the whole page from a hand-edited URL.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function OperationsPageShell({ Wizard, spinnerClass = 'border-blue-600' }: OperationsPageShellProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] bg-gray-50 flex items-center justify-center">
          <div className={`animate-spin rounded-full h-12 w-12 border-b-2 ${spinnerClass}`}></div>
        </div>
      }
    >
      <OperationsPageContent Wizard={Wizard} />
    </Suspense>
  );
}
