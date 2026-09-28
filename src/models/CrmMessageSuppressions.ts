import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmMessageSuppressionsAttributes {
  id: number;
  leadId: number | null;
  channel: 'email' | 'whatsapp' | 'sms';
  addressHash: string;
  reason: 'unsubscribed' | 'bounced' | 'complained' | 'manual' | 'invalid';
  source: string | null;
  createdAt: Date;
}

interface CrmMessageSuppressionsCreationAttributes extends Optional<CrmMessageSuppressionsAttributes,
  'id' | 'leadId' | 'source' | 'createdAt'> {}

class CrmMessageSuppressions extends Model<CrmMessageSuppressionsAttributes, CrmMessageSuppressionsCreationAttributes> implements CrmMessageSuppressionsAttributes {
  declare id: number;
  declare leadId: number | null;
  declare channel: 'email' | 'whatsapp' | 'sms';
  declare addressHash: string;
  declare reason: 'unsubscribed' | 'bounced' | 'complained' | 'manual' | 'invalid';
  declare source: string | null;
  declare createdAt: Date;

  public static associate(models: any) {
    CrmMessageSuppressions.belongsTo(models.CrmcForumLeads, { foreignKey: 'lead_id', targetKey: 'id', as: 'lead' });
  }
}

CrmMessageSuppressions.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    leadId: { type: DataTypes.INTEGER, allowNull: true, field: 'lead_id', references: { model: 'crm_forum_leads', key: 'id' } },
    channel: { type: DataTypes.ENUM('email', 'whatsapp', 'sms'), allowNull: false, field: 'channel' },
    addressHash: { type: DataTypes.CHAR(64), allowNull: false, field: 'address_hash' },
    reason: { type: DataTypes.ENUM('unsubscribed', 'bounced', 'complained', 'manual', 'invalid'), allowNull: false, field: 'reason' },
    source: { type: DataTypes.STRING(100), allowNull: true, field: 'source' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  {
    sequelize,
    modelName: 'CrmMessageSuppressions',
    tableName: 'crm_message_suppressions',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmMessageSuppressions };
export type { CrmMessageSuppressionsAttributes, CrmMessageSuppressionsCreationAttributes };
