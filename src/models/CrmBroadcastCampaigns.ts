import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmBroadcastCampaignsAttributes {
  id: number;
  branchId: number | null;
  channel: 'email' | 'whatsapp' | 'sms';
  name: string;
  templateVersionId: number;
  segmentId: number | null;
  segmentSnapshot: unknown;
  variableMapping: unknown;
  scheduledAtUtc: Date | null;
  scheduledTimezone: string | null;
  status: 'draft' | 'scheduled' | 'preflight' | 'launching' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  publishedConfigHash: string | null;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  repliedCount: number;
  launchedAt: Date | null;
  pausedAt: Date | null;
  cancelledAt: Date | null;
  completedAt: Date | null;
  cancelReason: string | null;
  createdBy: number;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmBroadcastCampaignsCreationAttributes extends Optional<CrmBroadcastCampaignsAttributes,
  'id' | 'branchId' | 'segmentId' | 'segmentSnapshot' | 'variableMapping' | 'scheduledAtUtc' | 'scheduledTimezone' | 'status' | 'publishedConfigHash' |
  'totalRecipients' | 'sentCount' | 'deliveredCount' | 'failedCount' | 'repliedCount' | 'launchedAt' | 'pausedAt' | 'cancelledAt' | 'completedAt' |
  'cancelReason' | 'isDeleted' | 'deletedAt' | 'createdAt' | 'updatedAt'> {}

class CrmBroadcastCampaigns extends Model<CrmBroadcastCampaignsAttributes, CrmBroadcastCampaignsCreationAttributes> implements CrmBroadcastCampaignsAttributes {
  declare id: number;
  declare branchId: number | null;
  declare channel: 'email' | 'whatsapp' | 'sms';
  declare name: string;
  declare templateVersionId: number;
  declare segmentId: number | null;
  declare segmentSnapshot: unknown;
  declare variableMapping: unknown;
  declare scheduledAtUtc: Date | null;
  declare scheduledTimezone: string | null;
  declare status: 'draft' | 'scheduled' | 'preflight' | 'launching' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
  declare publishedConfigHash: string | null;
  declare totalRecipients: number;
  declare sentCount: number;
  declare deliveredCount: number;
  declare failedCount: number;
  declare repliedCount: number;
  declare launchedAt: Date | null;
  declare pausedAt: Date | null;
  declare cancelledAt: Date | null;
  declare completedAt: Date | null;
  declare cancelReason: string | null;
  declare createdBy: number;
  declare isDeleted: boolean;
  declare deletedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmBroadcastCampaigns.belongsTo(models.CrmBranch, { foreignKey: 'branch_id', targetKey: 'id', as: 'dmBranch' });
    CrmBroadcastCampaigns.belongsTo(models.CrmMessageTemplateVersions, { foreignKey: 'template_version_id', targetKey: 'id', as: 'templateVersion' });
    CrmBroadcastCampaigns.belongsTo(models.CrmContactSegments, { foreignKey: 'segment_id', targetKey: 'id', as: 'segment' });
    CrmBroadcastCampaigns.belongsTo(models.CrmEmployee, { foreignKey: 'created_by', targetKey: 'id', as: 'createdEmployee' });
    CrmBroadcastCampaigns.hasMany(models.CrmBroadcastRecipients, { foreignKey: 'campaign_id', sourceKey: 'id', as: 'recipients' });
    CrmBroadcastCampaigns.hasMany(models.CrmBroadcastEvents, { foreignKey: 'campaign_id', sourceKey: 'id', as: 'events' });
  }
}

CrmBroadcastCampaigns.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id', references: { model: 'crm_branch', key: 'id' } },
    channel: { type: DataTypes.ENUM('email', 'whatsapp', 'sms'), allowNull: false, field: 'channel' },
    name: { type: DataTypes.STRING(255), allowNull: false, field: 'name' },
    templateVersionId: { type: DataTypes.INTEGER, allowNull: false, field: 'template_version_id', references: { model: 'crm_message_template_versions', key: 'id' } },
    segmentId: { type: DataTypes.INTEGER, allowNull: true, field: 'segment_id', references: { model: 'crm_contact_segments', key: 'id' } },
    segmentSnapshot: { type: DataTypes.JSON, allowNull: true, field: 'segment_snapshot' },
    variableMapping: { type: DataTypes.JSON, allowNull: true, field: 'variable_mapping' },
    scheduledAtUtc: { type: DataTypes.DATE, allowNull: true, field: 'scheduled_at_utc' },
    scheduledTimezone: { type: DataTypes.STRING(64), allowNull: true, field: 'scheduled_timezone' },
    status: { type: DataTypes.ENUM('draft', 'scheduled', 'preflight', 'launching', 'running', 'paused', 'completed', 'cancelled', 'failed'), allowNull: false, defaultValue: 'draft', field: 'status' },
    publishedConfigHash: { type: DataTypes.CHAR(64), allowNull: true, field: 'published_config_hash' },
    totalRecipients: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'total_recipients' },
    sentCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sent_count' },
    deliveredCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'delivered_count' },
    failedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'failed_count' },
    repliedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'replied_count' },
    launchedAt: { type: DataTypes.DATE, allowNull: true, field: 'launched_at' },
    pausedAt: { type: DataTypes.DATE, allowNull: true, field: 'paused_at' },
    cancelledAt: { type: DataTypes.DATE, allowNull: true, field: 'cancelled_at' },
    completedAt: { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
    cancelReason: { type: DataTypes.TEXT, allowNull: true, field: 'cancel_reason' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'created_by', references: { model: 'crm_employee', key: 'id' } },
    isDeleted: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'is_deleted' },
    deletedAt: { type: DataTypes.DATE, allowNull: true, field: 'deleted_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmBroadcastCampaigns',
    tableName: 'crm_broadcast_campaigns',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmBroadcastCampaigns };
export type { CrmBroadcastCampaignsAttributes, CrmBroadcastCampaignsCreationAttributes };
