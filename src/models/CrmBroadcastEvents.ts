import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmBroadcastEventsAttributes {
  id: number;
  recipientId: number;
  campaignId: number;
  eventType: 'accepted' | 'sent' | 'delivered' | 'read' | 'replied' | 'bounced' | 'complained' | 'failed' | 'opted_out';
  providerEventId: string | null;
  rawPayload: Record<string, unknown> | null;
  occurredAt: Date;
}

interface CrmBroadcastEventsCreationAttributes extends Optional<CrmBroadcastEventsAttributes,
  'id' | 'providerEventId' | 'rawPayload' | 'occurredAt'> {}

class CrmBroadcastEvents extends Model<CrmBroadcastEventsAttributes, CrmBroadcastEventsCreationAttributes> implements CrmBroadcastEventsAttributes {
  declare id: number;
  declare recipientId: number;
  declare campaignId: number;
  declare eventType: 'accepted' | 'sent' | 'delivered' | 'read' | 'replied' | 'bounced' | 'complained' | 'failed' | 'opted_out';
  declare providerEventId: string | null;
  declare rawPayload: Record<string, unknown> | null;
  declare occurredAt: Date;

  public static associate(models: any) {
    CrmBroadcastEvents.belongsTo(models.CrmBroadcastRecipients, { foreignKey: 'recipient_id', targetKey: 'id', as: 'recipient' });
    CrmBroadcastEvents.belongsTo(models.CrmBroadcastCampaigns, { foreignKey: 'campaign_id', targetKey: 'id', as: 'campaign' });
  }
}

CrmBroadcastEvents.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    recipientId: { type: DataTypes.INTEGER, allowNull: false, field: 'recipient_id', references: { model: 'crm_broadcast_recipients', key: 'id' } },
    campaignId: { type: DataTypes.INTEGER, allowNull: false, field: 'campaign_id', references: { model: 'crm_broadcast_campaigns', key: 'id' } },
    eventType: { type: DataTypes.ENUM('accepted', 'sent', 'delivered', 'read', 'replied', 'bounced', 'complained', 'failed', 'opted_out'), allowNull: false, field: 'event_type' },
    providerEventId: { type: DataTypes.STRING(191), allowNull: true, field: 'provider_event_id' },
    rawPayload: { type: DataTypes.JSON, allowNull: true, field: 'raw_payload' },
    occurredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
  },
  {
    sequelize,
    modelName: 'CrmBroadcastEvents',
    tableName: 'crm_broadcast_events',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmBroadcastEvents };
export type { CrmBroadcastEventsAttributes, CrmBroadcastEventsCreationAttributes };
