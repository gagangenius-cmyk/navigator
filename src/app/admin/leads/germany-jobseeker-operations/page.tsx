'use client';

import OperationsPageShell from '../operations-page-shell';
import GermanyJobSeekerOperationsWizard from '../germany-jobseeker-operations-wizard';

export default function GermanyJobseekerOperationsPage() {
  return <OperationsPageShell Wizard={GermanyJobSeekerOperationsWizard} spinnerClass="border-blue-600" />;
}
