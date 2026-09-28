import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmBotMessagesAttributes {
  id: number;
  sessionId: number;
  leadId: number | null;
  direction: 'inbound' | 'outbound';
  messageType: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  providerMessageId: string | null;
  dedupKey: string;
  nodeId: string | null;
  occurredAt: Date;
}

interface CrmBotMessagesCreationAttributes extends Optional<CrmBotMessagesAttributes,
  'id' | 'leadId' | 'messageType' | 'body' | 'payload' | 'providerMessageId' | 'nodeId' | 'occurredAt'> {}

class CrmBotMessages extends Model<CrmBotMessagesAttributes, CrmBotMessagesCreationAttributes> implements CrmBotMessagesAttributes {
  declare id: number;
  declare sessionId: number;
  declare leadId: number | null;
  declare direction: 'inbound' | 'outbound';
  declare messageType: string;
  declare body: string | null;
  declare payload: Record<string, unknown> | null;
  declare providerMessageId: string | null;
  declare dedupKey: string;
  declare nodeId: string | null;
  declare occurredAt: Date;

  public static associate(models: any) {
    CrmBotMessages.belongsTo(models.CrmBotSessions, { foreignKey: 'session_id', targetKey: 'id', as: 'session' });
    CrmBotMessages.belongsTo(models.CrmcForumLeads, { foreignKey: 'lead_id', targetKey: 'id', as: 'lead' });
  }
}

CrmBotMessages.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    sessionId: { type: DataTypes.INTEGER, allowNull: false, field: 'session_id', references: { model: 'crm_bot_sessions', key: 'id' } },
    leadId: { type: DataTypes.INTEGER, allowNull: true, field: 'lead_id', references: { model: 'crm_forum_leads', key: 'id' } },
    direction: { type: DataTypes.ENUM('inbound', 'outbound'), allowNull: false, field: 'direction' },
    messageType: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'text', field: 'message_type' },
    body: { type: DataTypes.TEXT, allowNull: true, field: 'body' },
    payload: { type: DataTypes.JSON, allowNull: true, field: 'payload' },
    providerMessageId: { type: DataTypes.STRING(191), allowNull: true, field: 'provider_message_id' },
    dedupKey: { type: DataTypes.CHAR(64), allowNull: false, field: 'dedup_key' },
    nodeId: { type: DataTypes.STRING(191), allowNull: true, field: 'node_id' },
    occurredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
  },
  {
    sequelize,
    modelName: 'CrmBotMessages',
    tableName: 'crm_bot_messages',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmBotMessages };
export type { CrmBotMessagesAttributes, CrmBotMessagesCreationAttributes };
