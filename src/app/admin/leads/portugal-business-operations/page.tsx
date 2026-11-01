'use client';

import OperationsPageShell from '../operations-page-shell';
import PortugalBusinessOperationsWizard from '../portugal-business-operations-wizard';

export default function PortugalBusinessOperationsPage() {
  return <OperationsPageShell Wizard={PortugalBusinessOperationsWizard} spinnerClass="border-blue-600" />;
}
