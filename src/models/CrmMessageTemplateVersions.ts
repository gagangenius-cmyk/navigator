import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmMessageTemplateVersionsAttributes {
  id: number;
  templateId: number;
  versionNumber: number;
  channel: 'email' | 'whatsapp' | 'sms';
  components: Record<string, unknown>;
  designJson: Record<string, unknown> | null;
  exportHtml: string | null;
  exportText: string | null;
  variableSchema: unknown;
  sampleValues: Record<string, unknown> | null;
  contentHash: string;
  isPublished: boolean;
  publishedAt: Date | null;
  createdBy: number;
  createdAt: Date;
}

interface CrmMessageTemplateVersionsCreationAttributes extends Optional<CrmMessageTemplateVersionsAttributes,
  'id' | 'designJson' | 'exportHtml' | 'exportText' | 'variableSchema' | 'sampleValues' | 'isPublished' | 'publishedAt' | 'createdAt'> {}

class CrmMessageTemplateVersions extends Model<CrmMessageTemplateVersionsAttributes, CrmMessageTemplateVersionsCreationAttributes> implements CrmMessageTemplateVersionsAttributes {
  declare id: number;
  declare templateId: number;
  declare versionNumber: number;
  declare channel: 'email' | 'whatsapp' | 'sms';
  declare components: Record<string, unknown>;
  declare designJson: Record<string, unknown> | null;
  declare exportHtml: string | null;
  declare exportText: string | null;
  declare variableSchema: unknown;
  declare sampleValues: Record<string, unknown> | null;
  declare contentHash: string;
  declare isPublished: boolean;
  declare publishedAt: Date | null;
  declare createdBy: number;
  declare createdAt: Date;

  public static associate(models: any) {
    CrmMessageTemplateVersions.belongsTo(models.CrmMessageTemplates, { foreignKey: 'template_id', targetKey: 'id', as: 'template' });
    CrmMessageTemplateVersions.belongsTo(models.CrmEmployee, { foreignKey: 'created_by', targetKey: 'id', as: 'createdEmployee' });
    CrmMessageTemplateVersions.hasMany(models.CrmMessageTemplateStatusEvents, { foreignKey: 'template_version_id', sourceKey: 'id', as: 'statusEvents' });
    CrmMessageTemplateVersions.hasMany(models.CrmBroadcastCampaigns, { foreignKey: 'template_version_id', sourceKey: 'id', as: 'campaigns' });
  }
}

CrmMessageTemplateVersions.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    templateId: { type: DataTypes.INTEGER, allowNull: false, field: 'template_id', references: { model: 'crm_message_templates', key: 'id' } },
    versionNumber: { type: DataTypes.INTEGER, allowNull: false, field: 'version_number' },
    channel: { type: DataTypes.ENUM('email', 'whatsapp', 'sms'), allowNull: false, field: 'channel' },
    components: { type: DataTypes.JSON, allowNull: false, field: 'components' },
    designJson: { type: DataTypes.JSON, allowNull: true, field: 'design_json' },
    exportHtml: { type: DataTypes.TEXT('long'), allowNull: true, field: 'export_html' },
    exportText: { type: DataTypes.TEXT('long'), allowNull: true, field: 'export_text' },
    variableSchema: { type: DataTypes.JSON, allowNull: true, field: 'variable_schema' },
    sampleValues: { type: DataTypes.JSON, allowNull: true, field: 'sample_values' },
    contentHash: { type: DataTypes.CHAR(64), allowNull: false, field: 'content_hash' },
    isPublished: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'is_published' },
    publishedAt: { type: DataTypes.DATE, allowNull: true, field: 'published_at' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'created_by', references: { model: 'crm_employee', key: 'id' } },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  {
    sequelize,
    modelName: 'CrmMessageTemplateVersions',
    tableName: 'crm_message_template_versions',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmMessageTemplateVersions };
export type { CrmMessageTemplateVersionsAttributes, CrmMessageTemplateVersionsCreationAttributes };
