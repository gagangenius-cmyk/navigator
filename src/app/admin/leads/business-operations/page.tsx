'use client';

import OperationsPageShell from '../operations-page-shell';
import BusinessOperationsWizard from '../business-operations-wizard';

export default function BusinessOperationsPage() {
  return <OperationsPageShell Wizard={BusinessOperationsWizard} spinnerClass="border-blue-600" />;
}
