import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmWorkflowEnrollmentsAttributes {
  id: number;
  workflowVersionId: number;
  leadId: number | null;
  subjectType: string;
  correlationId: string;
  enrollmentPolicyKey: string | null;
  status: 'active' | 'waiting' | 'completed' | 'cancelled' | 'failed';
  startedAt: Date;
  endedAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmWorkflowEnrollmentsCreationAttributes extends Optional<CrmWorkflowEnrollmentsAttributes,
  'id' | 'leadId' | 'subjectType' | 'enrollmentPolicyKey' | 'status' | 'startedAt' | 'endedAt' | 'cancelReason' | 'createdAt' | 'updatedAt'> {}

class CrmWorkflowEnrollments extends Model<CrmWorkflowEnrollmentsAttributes, CrmWorkflowEnrollmentsCreationAttributes> implements CrmWorkflowEnrollmentsAttributes {
  declare id: number;
  declare workflowVersionId: number;
  declare leadId: number | null;
  declare subjectType: string;
  declare correlationId: string;
  declare enrollmentPolicyKey: string | null;
  declare status: 'active' | 'waiting' | 'completed' | 'cancelled' | 'failed';
  declare startedAt: Date;
  declare endedAt: Date | null;
  declare cancelReason: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmWorkflowEnrollments.belongsTo(models.CrmWorkflowVersions, { foreignKey: 'workflow_version_id', targetKey: 'id', as: 'workflowVersion' });
    CrmWorkflowEnrollments.belongsTo(models.CrmcForumLeads, { foreignKey: 'lead_id', targetKey: 'id', as: 'lead' });
    CrmWorkflowEnrollments.hasMany(models.CrmWorkflowStepExecutions, { foreignKey: 'enrollment_id', sourceKey: 'id', as: 'stepExecutions' });
    CrmWorkflowEnrollments.hasMany(models.CrmWorkflowWaits, { foreignKey: 'enrollment_id', sourceKey: 'id', as: 'waits' });
    CrmWorkflowEnrollments.hasMany(models.CrmBotSessions, { foreignKey: 'enrollment_id', sourceKey: 'id', as: 'botSessions' });
  }
}

CrmWorkflowEnrollments.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    workflowVersionId: { type: DataTypes.INTEGER, allowNull: false, field: 'workflow_version_id', references: { model: 'crm_workflow_versions', key: 'id' } },
    leadId: { type: DataTypes.INTEGER, allowNull: true, field: 'lead_id', references: { model: 'crm_forum_leads', key: 'id' } },
    subjectType: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'lead', field: 'subject_type' },
    correlationId: { type: DataTypes.CHAR(36), allowNull: false, field: 'correlation_id' },
    enrollmentPolicyKey: { type: DataTypes.STRING(191), allowNull: true, field: 'enrollment_policy_key' },
    status: { type: DataTypes.ENUM('active', 'waiting', 'completed', 'cancelled', 'failed'), allowNull: false, defaultValue: 'active', field: 'status' },
    startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'started_at' },
    endedAt: { type: DataTypes.DATE, allowNull: true, field: 'ended_at' },
    cancelReason: { type: DataTypes.TEXT, allowNull: true, field: 'cancel_reason' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmWorkflowEnrollments',
    tableName: 'crm_workflow_enrollments',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmWorkflowEnrollments };
export type { CrmWorkflowEnrollmentsAttributes, CrmWorkflowEnrollmentsCreationAttributes };
