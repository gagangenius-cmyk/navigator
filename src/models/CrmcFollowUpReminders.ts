import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';
import { syncLeadFollowup } from '../lib/leadSchedule';

export interface CrmcFollowUpRemindersAttributes {
  id: number;
  lead_id: number;
  user_id: number;
  reminder_date: Date;
  message: string;
  status: string;
  priority: string;
  completed_at?: Date;
  // Notes added when completing/rescheduling/cancelling a follow-up — kept
  // separate from `message` (the original follow-up task description) so
  // recording a remark never overwrites it.
  completion_notes?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CrmcFollowUpRemindersCreationAttributes extends Optional<CrmcFollowUpRemindersAttributes, 'id' | 'status' | 'priority' | 'completed_at' | 'completion_notes' | 'created_at' | 'updated_at'> {}

export class CrmcFollowUpReminders extends Model<CrmcFollowUpRemindersAttributes, CrmcFollowUpRemindersCreationAttributes> implements CrmcFollowUpRemindersAttributes {
  declare id: number;
  declare lead_id: number;
  declare user_id: number;
  declare reminder_date: Date;
  declare message: string;
  declare status: string;
  declare priority: string;
  declare completed_at?: Date;
  declare completion_notes?: string | null;
  declare created_at: Date;
  declare updated_at: Date;

  // Associations
  declare dmcForumLead?: any;
  declare dmEmployee?: any;

  public static associate(models: any) {
    CrmcFollowUpReminders.belongsTo(models.CrmcForumLeads, {
      foreignKey: 'lead_id',
      as: 'dmcForumLead'
    });
    
    CrmcFollowUpReminders.belongsTo(models.CrmEmployee, {
      foreignKey: 'user_id',
      as: 'dmEmployee'
    });
  }
}

CrmcFollowUpReminders.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    lead_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    reminder_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
    },
    priority: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'medium',
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completion_notes: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'CrmcFollowUpReminders',
    tableName: 'crm_follow_up_reminders',
    timestamps: false,
    freezeTableName: true,
  }
);

// A lead's own followup/folowuptime/followupstat columns mirror its earliest open
// reminder (read by the Leads list, dashboard tile, monitoring, reports). Syncing at
// the model covers every writer that goes through it - the follow-up API, lead edit,
// lead-to-opportunity (inside its transaction), workflow tasks - instead of each
// caller remembering a second write. Static bulk updates and raw SQL bypass
// instance hooks, so those callers call syncLeadFollowup() themselves.
// See lib/leadSchedule.ts.
type ReminderSyncState = { __prevLeadId?: number | null };
const syncSafely = async (leadId: unknown, options: { transaction?: unknown }) => {
  try {
    await syncLeadFollowup(leadId as number, { transaction: options.transaction as never });
  } catch (error) {
    // Never fail the reminder write because the mirror columns couldn't update.
    console.error('Failed to sync lead follow-up columns:', error);
  }
};
CrmcFollowUpReminders.addHook('beforeUpdate', (reminder) => {
  (reminder as unknown as ReminderSyncState).__prevLeadId = reminder.previous('lead_id') as number | null;
});
CrmcFollowUpReminders.addHook('afterSave', async (reminder, options) => {
  const current = reminder.getDataValue('lead_id');
  await syncSafely(current, options);
  const previous = (reminder as unknown as ReminderSyncState).__prevLeadId;
  if (previous && Number(previous) !== Number(current)) await syncSafely(previous, options);
});
CrmcFollowUpReminders.addHook('afterDestroy', async (reminder, options) => {
  await syncSafely(reminder.getDataValue('lead_id'), options);
});
