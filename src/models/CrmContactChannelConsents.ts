import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmContactChannelConsentsAttributes {
  id: number;
  leadId: number;
  channel: 'email' | 'whatsapp' | 'sms';
  purpose: string;
  address: string | null;
  consentState: 'opted_in' | 'opted_out' | 'unknown';
  source: string | null;
  proof: string | null;
  optedInAt: Date | null;
  optedOutAt: Date | null;
  updatedBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmContactChannelConsentsCreationAttributes extends Optional<CrmContactChannelConsentsAttributes,
  'id' | 'purpose' | 'address' | 'consentState' | 'source' | 'proof' | 'optedInAt' | 'optedOutAt' | 'updatedBy' | 'createdAt' | 'updatedAt'> {}

class CrmContactChannelConsents extends Model<CrmContactChannelConsentsAttributes, CrmContactChannelConsentsCreationAttributes> implements CrmContactChannelConsentsAttributes {
  declare id: number;
  declare leadId: number;
  declare channel: 'email' | 'whatsapp' | 'sms';
  declare purpose: string;
  declare address: string | null;
  declare consentState: 'opted_in' | 'opted_out' | 'unknown';
  declare source: string | null;
  declare proof: string | null;
  declare optedInAt: Date | null;
  declare optedOutAt: Date | null;
  declare updatedBy: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmContactChannelConsents.belongsTo(models.CrmcForumLeads, { foreignKey: 'lead_id', targetKey: 'id', as: 'lead' });
    CrmContactChannelConsents.belongsTo(models.CrmEmployee, { foreignKey: 'updated_by', targetKey: 'id', as: 'updatedByEmployee' });
  }
}

CrmContactChannelConsents.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    leadId: { type: DataTypes.INTEGER, allowNull: false, field: 'lead_id', references: { model: 'crm_forum_leads', key: 'id' } },
    channel: { type: DataTypes.ENUM('email', 'whatsapp', 'sms'), allowNull: false, field: 'channel' },
    purpose: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'marketing', field: 'purpose' },
    address: { type: DataTypes.STRING(255), allowNull: true, field: 'address' },
    consentState: { type: DataTypes.ENUM('opted_in', 'opted_out', 'unknown'), allowNull: false, defaultValue: 'unknown', field: 'consent_state' },
    source: { type: DataTypes.STRING(100), allowNull: true, field: 'source' },
    proof: { type: DataTypes.TEXT, allowNull: true, field: 'proof' },
    optedInAt: { type: DataTypes.DATE, allowNull: true, field: 'opted_in_at' },
    optedOutAt: { type: DataTypes.DATE, allowNull: true, field: 'opted_out_at' },
    updatedBy: { type: DataTypes.INTEGER, allowNull: true, field: 'updated_by', references: { model: 'crm_employee', key: 'id' } },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmContactChannelConsents',
    tableName: 'crm_contact_channel_consents',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmContactChannelConsents };
export type { CrmContactChannelConsentsAttributes, CrmContactChannelConsentsCreationAttributes };
