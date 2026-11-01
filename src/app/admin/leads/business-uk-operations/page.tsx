'use client';

import OperationsPageShell from '../operations-page-shell';
import BusinessUkOperationsWizard from '../business-uk-operations-wizard';

export default function BusinessUkOperationsPage() {
  return <OperationsPageShell Wizard={BusinessUkOperationsWizard} spinnerClass="border-blue-600" />;
}
