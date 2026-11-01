'use client';

import OperationsPageShell from '../operations-page-shell';
import RMSOperationsWizard from '../rms-operations-wizard';

export default function RmsOperationsPage() {
  return <OperationsPageShell Wizard={RMSOperationsWizard} spinnerClass="border-blue-600" />;
}
