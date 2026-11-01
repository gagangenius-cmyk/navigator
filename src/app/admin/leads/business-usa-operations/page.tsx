'use client';

import OperationsPageShell from '../operations-page-shell';
import BusinessUsaOperationsWizard from '../business-usa-operations-wizard';

export default function BusinessUsaOperationsPage() {
  return <OperationsPageShell Wizard={BusinessUsaOperationsWizard} spinnerClass="border-blue-600" />;
}
