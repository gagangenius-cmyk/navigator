'use client';

import OperationsPageShell from '../operations-page-shell';
import WorkOperationsWizard from '../work-operations-wizard';

export default function WorkOperationsPage() {
  return <OperationsPageShell Wizard={WorkOperationsWizard} spinnerClass="border-blue-600" />;
}
