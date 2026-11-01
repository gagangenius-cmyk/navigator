'use client';

import OperationsPageShell from '../operations-page-shell';
import CbiOperationsWizard from '../cbi-operations-wizard';

export default function CbiOperationsPage() {
  return <OperationsPageShell Wizard={CbiOperationsWizard} spinnerClass="border-blue-600" />;
}
