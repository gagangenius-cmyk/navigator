'use client';

import OperationsPageShell from '../operations-page-shell';
import EuropeCasesOperationsWizard from '../europe-cases-operations-wizard';

export default function EuropeCasesOperationsPage() {
  return <OperationsPageShell Wizard={EuropeCasesOperationsWizard} spinnerClass="border-blue-600" />;
}
