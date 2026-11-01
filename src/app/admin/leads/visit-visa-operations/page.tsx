'use client';

import OperationsPageShell from '../operations-page-shell';
import VisitVisaOperationsWizard from '../visit-visa-operations-wizard';

export default function VisitVisaOperationsPage() {
  return <OperationsPageShell Wizard={VisitVisaOperationsWizard} spinnerClass="border-blue-600" />;
}
