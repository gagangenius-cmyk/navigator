'use client';

import OperationsPageShell from '../operations-page-shell';
import SkillAustraliaOperationsWizard from '../skill-australia-operations-wizard';

export default function SkillAustraliaOperationsPage() {
  return <OperationsPageShell Wizard={SkillAustraliaOperationsWizard} spinnerClass="border-yellow-600" />;
}
