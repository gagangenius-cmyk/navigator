import { describe, expect, it } from 'vitest';
// Imported directly (not via src/models/index.ts) so this test never
// triggers the full 300+ model associate() graph - Sequelize.init() itself
// only registers metadata on the shared sequelize instance, it never opens
// a connection, so this is safe to run with no DATABASE_URL/DB reachable
// (matching vitest.config.mts's "never touches the DB or network" contract).
import { CrmMessageTemplates } from '../../src/models/CrmMessageTemplates';
import { CrmMessageTemplateVersions } from '../../src/models/CrmMessageTemplateVersions';
import { CrmBroadcastRecipients } from '../../src/models/CrmBroadcastRecipients';
import { CrmWorkflowStepExecutions } from '../../src/models/CrmWorkflowStepExecutions';
import { CrmAutomationOutbox } from '../../src/models/CrmAutomationOutbox';

describe('broadcast automation models', () => {
  it('maps every model to the exact crm_ table name created in migrations/20261001_broadcast_automation_schema.sql', () => {
    expect(CrmMessageTemplates.getTableName()).toBe('crm_message_templates');
    expect(CrmMessageTemplateVersions.getTableName()).toBe('crm_message_template_versions');
    expect(CrmBroadcastRecipients.getTableName()).toBe('crm_broadcast_recipients');
    expect(CrmWorkflowStepExecutions.getTableName()).toBe('crm_workflow_step_executions');
    expect(CrmAutomationOutbox.getTableName()).toBe('crm_automation_outbox');
  });

  it('maps every camelCase attribute to its snake_case column, so a raw SELECT and a Sequelize read agree', () => {
    const recipientFields = CrmBroadcastRecipients.getAttributes();
    expect(recipientFields.idempotencyKey.field).toBe('idempotency_key');
    expect(recipientFields.campaignId.field).toBe('campaign_id');
    expect(recipientFields.addressSnapshot.field).toBe('address_snapshot');

    const stepFields = CrmWorkflowStepExecutions.getAttributes();
    expect(stepFields.idempotencyKey.field).toBe('idempotency_key');
    expect(stepFields.enrollmentId.field).toBe('enrollment_id');
  });

  it('disables Sequelize-managed timestamps, matching this codebase\'s convention of explicit created_at/updated_at columns', () => {
    expect((CrmMessageTemplates as unknown as { options: { timestamps: boolean } }).options.timestamps).toBe(false);
    expect((CrmAutomationOutbox as unknown as { options: { timestamps: boolean } }).options.timestamps).toBe(false);
  });
});
