'use client';

import OperationsPageShell from '../operations-page-shell';
import SkillCanadaPipOperationsWizard from '../skill-canada-pip-operations-wizard';

export default function SkillCanadaPipOperationsPage() {
  return <OperationsPageShell Wizard={SkillCanadaPipOperationsWizard} spinnerClass="border-blue-600" />;
}
