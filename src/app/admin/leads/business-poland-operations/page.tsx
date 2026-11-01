'use client';

import OperationsPageShell from '../operations-page-shell';
import BusinessPolandOperationsWizard from '../business-poland-operations-wizard';

export default function BusinessPolandOperationsPage() {
  return <OperationsPageShell Wizard={BusinessPolandOperationsWizard} spinnerClass="border-blue-600" />;
}
