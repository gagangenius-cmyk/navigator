'use client';

import OperationsPageShell from '../operations-page-shell';
import WorkPermitOperationsWizard from '../work-permit-operations-wizard';

export default function WorkPermitOperationsPage() {
  return <OperationsPageShell Wizard={WorkPermitOperationsWizard} spinnerClass="border-blue-600" />;
}
