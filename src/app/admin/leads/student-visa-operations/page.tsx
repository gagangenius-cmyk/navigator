'use client';

import OperationsPageShell from '../operations-page-shell';
import StudentVisaOperationsWizard from '../student-visa-operations-wizard';

export default function StudentVisaOperationsPage() {
  return <OperationsPageShell Wizard={StudentVisaOperationsWizard} spinnerClass="border-green-600" />;
}
