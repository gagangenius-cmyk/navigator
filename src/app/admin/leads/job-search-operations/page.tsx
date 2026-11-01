'use client';

import OperationsPageShell from '../operations-page-shell';
import JobSearchOperationsWizard from '../job-search-operations-wizard';

export default function JobSearchOperationsPage() {
  return <OperationsPageShell Wizard={JobSearchOperationsWizard} spinnerClass="border-blue-600" />;
}
