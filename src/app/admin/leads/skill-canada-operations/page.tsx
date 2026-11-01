'use client';

import OperationsPageShell from '../operations-page-shell';
import SkillCanadaOperationsWizard from '../skill-canada-operations-wizard';

export default function SkillCanadaOperationsPage() {
  return <OperationsPageShell Wizard={SkillCanadaOperationsWizard} spinnerClass="border-red-600" />;
}
