'use client';

import OperationsPageShell from '../operations-page-shell';
import IctCanadaOperationsWizard from '../ict-canada-operations-wizard';

export default function IctCanadaOperationsPage() {
  return <OperationsPageShell Wizard={IctCanadaOperationsWizard} spinnerClass="border-blue-600" />;
}
