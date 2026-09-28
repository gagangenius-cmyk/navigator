import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmBotSessionsAttributes {
  id: number;
  branchId: number | null;
  channel: 'whatsapp' | 'sms';
  leadId: number | null;
  address: string;
  workflowVersionId: number;
  enrollmentId: number | null;
  currentNodeId: string | null;
  sessionState: Record<string, unknown> | null;
  status: 'active' | 'handed_off' | 'completed' | 'expired' | 'opted_out';
  handoffAt: Date | null;
  handoffAgentId: number | null;
  handoffReason: string | null;
  expiresAt: Date | null;
  lastInboundAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmBotSessionsCreationAttributes extends Optional<CrmBotSessionsAttributes,
  'id' | 'branchId' | 'leadId' | 'enrollmentId' | 'currentNodeId' | 'sessionState' | 'status' | 'handoffAt' | 'handoffAgentId' | 'handoffReason' |
  'expiresAt' | 'lastInboundAt' | 'createdAt' | 'updatedAt'> {}

class CrmBotSessions extends Model<CrmBotSessionsAttributes, CrmBotSessionsCreationAttributes> implements CrmBotSessionsAttributes {
  declare id: number;
  declare branchId: number | null;
  declare channel: 'whatsapp' | 'sms';
  declare leadId: number | null;
  declare address: string;
  declare workflowVersionId: number;
  declare enrollmentId: number | null;
  declare currentNodeId: string | null;
  declare sessionState: Record<string, unknown> | null;
  declare status: 'active' | 'handed_off' | 'completed' | 'expired' | 'opted_out';
  declare handoffAt: Date | null;
  declare handoffAgentId: number | null;
  declare handoffReason: string | null;
  declare expiresAt: Date | null;
  declare lastInboundAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmBotSessions.belongsTo(models.CrmBranch, { foreignKey: 'branch_id', targetKey: 'id', as: 'dmBranch' });
    CrmBotSessions.belongsTo(models.CrmcForumLeads, { foreignKey: 'lead_id', targetKey: 'id', as: 'lead' });
    CrmBotSessions.belongsTo(models.CrmWorkflowVersions, { foreignKey: 'workflow_version_id', targetKey: 'id', as: 'workflowVersion' });
    CrmBotSessions.belongsTo(models.CrmWorkflowEnrollments, { foreignKey: 'enrollment_id', targetKey: 'id', as: 'enrollment' });
    CrmBotSessions.belongsTo(models.CrmEmployee, { foreignKey: 'handoff_agent_id', targetKey: 'id', as: 'handoffAgent' });
    CrmBotSessions.hasMany(models.CrmBotMessages, { foreignKey: 'session_id', sourceKey: 'id', as: 'messages' });
  }
}

CrmBotSessions.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id', references: { model: 'crm_branch', key: 'id' } },
    channel: { type: DataTypes.ENUM('whatsapp', 'sms'), allowNull: false, field: 'channel' },
    leadId: { type: DataTypes.INTEGER, allowNull: true, field: 'lead_id', references: { model: 'crm_forum_leads', key: 'id' } },
    address: { type: DataTypes.STRING(255), allowNull: false, field: 'address' },
    workflowVersionId: { type: DataTypes.INTEGER, allowNull: false, field: 'workflow_version_id', references: { model: 'crm_workflow_versions', key: 'id' } },
    enrollmentId: { type: DataTypes.INTEGER, allowNull: true, field: 'enrollment_id', references: { model: 'crm_workflow_enrollments', key: 'id' } },
    currentNodeId: { type: DataTypes.STRING(191), allowNull: true, field: 'current_node_id' },
    sessionState: { type: DataTypes.JSON, allowNull: true, field: 'session_state' },
    status: { type: DataTypes.ENUM('active', 'handed_off', 'completed', 'expired', 'opted_out'), allowNull: false, defaultValue: 'active', field: 'status' },
    handoffAt: { type: DataTypes.DATE, allowNull: true, field: 'handoff_at' },
    handoffAgentId: { type: DataTypes.INTEGER, allowNull: true, field: 'handoff_agent_id', references: { model: 'crm_employee', key: 'id' } },
    handoffReason: { type: DataTypes.TEXT, allowNull: true, field: 'handoff_reason' },
    expiresAt: { type: DataTypes.DATE, allowNull: true, field: 'expires_at' },
    lastInboundAt: { type: DataTypes.DATE, allowNull: true, field: 'last_inbound_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmBotSessions',
    tableName: 'crm_bot_sessions',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmBotSessions };
export type { CrmBotSessionsAttributes, CrmBotSessionsCreationAttributes };
