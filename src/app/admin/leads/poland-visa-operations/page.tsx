'use client';

import OperationsPageShell from '../operations-page-shell';
import PolandVisaOperationsWizard from '../poland-visa-operations-wizard';

export default function PolandVisaOperationsPage() {
  return <OperationsPageShell Wizard={PolandVisaOperationsWizard} spinnerClass="border-indigo-600" />;
}
