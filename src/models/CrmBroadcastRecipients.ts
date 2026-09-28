import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmBroadcastRecipientsAttributes {
  id: number;
  campaignId: number;
  leadId: number | null;
  channel: 'email' | 'whatsapp' | 'sms';
  addressSnapshot: string;
  templateVersionId: number;
  renderedVariables: Record<string, unknown> | null;
  status: 'pending' | 'queued' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'skipped_suppressed' | 'skipped_consent' | 'skipped_cancelled';
  attempts: number;
  providerMessageId: string | null;
  claimedAt: Date | null;
  claimedBy: string | null;
  idempotencyKey: string;
  failureReason: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  repliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmBroadcastRecipientsCreationAttributes extends Optional<CrmBroadcastRecipientsAttributes,
  'id' | 'leadId' | 'renderedVariables' | 'status' | 'attempts' | 'providerMessageId' | 'claimedAt' | 'claimedBy' | 'failureReason' |
  'sentAt' | 'deliveredAt' | 'readAt' | 'repliedAt' | 'createdAt' | 'updatedAt'> {}

class CrmBroadcastRecipients extends Model<CrmBroadcastRecipientsAttributes, CrmBroadcastRecipientsCreationAttributes> implements CrmBroadcastRecipientsAttributes {
  declare id: number;
  declare campaignId: number;
  declare leadId: number | null;
  declare channel: 'email' | 'whatsapp' | 'sms';
  declare addressSnapshot: string;
  declare templateVersionId: number;
  declare renderedVariables: Record<string, unknown> | null;
  declare status: 'pending' | 'queued' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'skipped_suppressed' | 'skipped_consent' | 'skipped_cancelled';
  declare attempts: number;
  declare providerMessageId: string | null;
  declare claimedAt: Date | null;
  declare claimedBy: string | null;
  declare idempotencyKey: string;
  declare failureReason: string | null;
  declare sentAt: Date | null;
  declare deliveredAt: Date | null;
  declare readAt: Date | null;
  declare repliedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmBroadcastRecipients.belongsTo(models.CrmBroadcastCampaigns, { foreignKey: 'campaign_id', targetKey: 'id', as: 'campaign' });
    CrmBroadcastRecipients.belongsTo(models.CrmcForumLeads, { foreignKey: 'lead_id', targetKey: 'id', as: 'lead' });
    CrmBroadcastRecipients.belongsTo(models.CrmMessageTemplateVersions, { foreignKey: 'template_version_id', targetKey: 'id', as: 'templateVersion' });
    CrmBroadcastRecipients.hasMany(models.CrmBroadcastEvents, { foreignKey: 'recipient_id', sourceKey: 'id', as: 'events' });
  }
}

CrmBroadcastRecipients.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    campaignId: { type: DataTypes.INTEGER, allowNull: false, field: 'campaign_id', references: { model: 'crm_broadcast_campaigns', key: 'id' } },
    leadId: { type: DataTypes.INTEGER, allowNull: true, field: 'lead_id', references: { model: 'crm_forum_leads', key: 'id' } },
    channel: { type: DataTypes.ENUM('email', 'whatsapp', 'sms'), allowNull: false, field: 'channel' },
    addressSnapshot: { type: DataTypes.STRING(255), allowNull: false, field: 'address_snapshot' },
    templateVersionId: { type: DataTypes.INTEGER, allowNull: false, field: 'template_version_id', references: { model: 'crm_message_template_versions', key: 'id' } },
    renderedVariables: { type: DataTypes.JSON, allowNull: true, field: 'rendered_variables' },
    status: {
      type: DataTypes.ENUM('pending', 'queued', 'sent', 'delivered', 'read', 'replied', 'failed', 'skipped_suppressed', 'skipped_consent', 'skipped_cancelled'),
      allowNull: false,
      defaultValue: 'pending',
      field: 'status',
    },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'attempts' },
    providerMessageId: { type: DataTypes.STRING(191), allowNull: true, field: 'provider_message_id' },
    claimedAt: { type: DataTypes.DATE, allowNull: true, field: 'claimed_at' },
    claimedBy: { type: DataTypes.STRING(100), allowNull: true, field: 'claimed_by' },
    idempotencyKey: { type: DataTypes.CHAR(64), allowNull: false, field: 'idempotency_key' },
    failureReason: { type: DataTypes.TEXT, allowNull: true, field: 'failure_reason' },
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    deliveredAt: { type: DataTypes.DATE, allowNull: true, field: 'delivered_at' },
    readAt: { type: DataTypes.DATE, allowNull: true, field: 'read_at' },
    repliedAt: { type: DataTypes.DATE, allowNull: true, field: 'replied_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmBroadcastRecipients',
    tableName: 'crm_broadcast_recipients',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmBroadcastRecipients };
export type { CrmBroadcastRecipientsAttributes, CrmBroadcastRecipientsCreationAttributes };
