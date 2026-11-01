'use client';

import OperationsPageShell from '../operations-page-shell';
import BusinessCanadaOperationsWizard from '../business-canada-operations-wizard';

export default function BusinessCanadaOperationsPage() {
  return <OperationsPageShell Wizard={BusinessCanadaOperationsWizard} spinnerClass="border-blue-600" />;
}
