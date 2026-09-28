import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmMessageTemplateStatusEventsAttributes {
  id: number;
  templateId: number;
  templateVersionId: number | null;
  providerEventId: string | null;
  eventType: 'submitted' | 'approved' | 'rejected' | 'disabled' | 'quality_update' | 'flagged';
  providerStatus: string | null;
  rejectionReason: string | null;
  qualityRating: string | null;
  rawPayload: Record<string, unknown> | null;
  occurredAt: Date;
}

interface CrmMessageTemplateStatusEventsCreationAttributes extends Optional<CrmMessageTemplateStatusEventsAttributes,
  'id' | 'templateVersionId' | 'providerEventId' | 'providerStatus' | 'rejectionReason' | 'qualityRating' | 'rawPayload' | 'occurredAt'> {}

class CrmMessageTemplateStatusEvents extends Model<CrmMessageTemplateStatusEventsAttributes, CrmMessageTemplateStatusEventsCreationAttributes> implements CrmMessageTemplateStatusEventsAttributes {
  declare id: number;
  declare templateId: number;
  declare templateVersionId: number | null;
  declare providerEventId: string | null;
  declare eventType: 'submitted' | 'approved' | 'rejected' | 'disabled' | 'quality_update' | 'flagged';
  declare providerStatus: string | null;
  declare rejectionReason: string | null;
  declare qualityRating: string | null;
  declare rawPayload: Record<string, unknown> | null;
  declare occurredAt: Date;

  public static associate(models: any) {
    CrmMessageTemplateStatusEvents.belongsTo(models.CrmMessageTemplates, { foreignKey: 'template_id', targetKey: 'id', as: 'template' });
    CrmMessageTemplateStatusEvents.belongsTo(models.CrmMessageTemplateVersions, { foreignKey: 'template_version_id', targetKey: 'id', as: 'templateVersion' });
  }
}

CrmMessageTemplateStatusEvents.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    templateId: { type: DataTypes.INTEGER, allowNull: false, field: 'template_id', references: { model: 'crm_message_templates', key: 'id' } },
    templateVersionId: { type: DataTypes.INTEGER, allowNull: true, field: 'template_version_id', references: { model: 'crm_message_template_versions', key: 'id' } },
    providerEventId: { type: DataTypes.STRING(128), allowNull: true, field: 'provider_event_id' },
    eventType: { type: DataTypes.ENUM('submitted', 'approved', 'rejected', 'disabled', 'quality_update', 'flagged'), allowNull: false, field: 'event_type' },
    providerStatus: { type: DataTypes.STRING(50), allowNull: true, field: 'provider_status' },
    rejectionReason: { type: DataTypes.TEXT, allowNull: true, field: 'rejection_reason' },
    qualityRating: { type: DataTypes.STRING(50), allowNull: true, field: 'quality_rating' },
    rawPayload: { type: DataTypes.JSON, allowNull: true, field: 'raw_payload' },
    occurredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
  },
  {
    sequelize,
    modelName: 'CrmMessageTemplateStatusEvents',
    tableName: 'crm_message_template_status_events',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmMessageTemplateStatusEvents };
export type { CrmMessageTemplateStatusEventsAttributes, CrmMessageTemplateStatusEventsCreationAttributes };
