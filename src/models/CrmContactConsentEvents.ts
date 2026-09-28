import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmContactConsentEventsAttributes {
  id: number;
  leadId: number;
  channel: 'email' | 'whatsapp' | 'sms';
  purpose: string;
  eventType: 'opt_in' | 'opt_out';
  source: string | null;
  proof: string | null;
  actorId: number | null;
  occurredAt: Date;
}

interface CrmContactConsentEventsCreationAttributes extends Optional<CrmContactConsentEventsAttributes,
  'id' | 'purpose' | 'source' | 'proof' | 'actorId' | 'occurredAt'> {}

class CrmContactConsentEvents extends Model<CrmContactConsentEventsAttributes, CrmContactConsentEventsCreationAttributes> implements CrmContactConsentEventsAttributes {
  declare id: number;
  declare leadId: number;
  declare channel: 'email' | 'whatsapp' | 'sms';
  declare purpose: string;
  declare eventType: 'opt_in' | 'opt_out';
  declare source: string | null;
  declare proof: string | null;
  declare actorId: number | null;
  declare occurredAt: Date;

  public static associate(models: any) {
    CrmContactConsentEvents.belongsTo(models.CrmcForumLeads, { foreignKey: 'lead_id', targetKey: 'id', as: 'lead' });
    CrmContactConsentEvents.belongsTo(models.CrmEmployee, { foreignKey: 'actor_id', targetKey: 'id', as: 'actorEmployee' });
  }
}

CrmContactConsentEvents.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    leadId: { type: DataTypes.INTEGER, allowNull: false, field: 'lead_id', references: { model: 'crm_forum_leads', key: 'id' } },
    channel: { type: DataTypes.ENUM('email', 'whatsapp', 'sms'), allowNull: false, field: 'channel' },
    purpose: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'marketing', field: 'purpose' },
    eventType: { type: DataTypes.ENUM('opt_in', 'opt_out'), allowNull: false, field: 'event_type' },
    source: { type: DataTypes.STRING(100), allowNull: true, field: 'source' },
    proof: { type: DataTypes.TEXT, allowNull: true, field: 'proof' },
    actorId: { type: DataTypes.INTEGER, allowNull: true, field: 'actor_id', references: { model: 'crm_employee', key: 'id' } },
    occurredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
  },
  {
    sequelize,
    modelName: 'CrmContactConsentEvents',
    tableName: 'crm_contact_consent_events',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmContactConsentEvents };
export type { CrmContactConsentEventsAttributes, CrmContactConsentEventsCreationAttributes };
