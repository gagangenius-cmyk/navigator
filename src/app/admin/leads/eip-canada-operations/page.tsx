'use client';

import OperationsPageShell from '../operations-page-shell';
import EIPCanadaOperationsWizard from '../eip-canada-operations-wizard';

export default function EipCanadaOperationsPage() {
  return <OperationsPageShell Wizard={EIPCanadaOperationsWizard} spinnerClass="border-purple-600" />;
}
