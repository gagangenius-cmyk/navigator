import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmMessageTemplatesAttributes {
  id: number;
  branchId: number | null;
  channel: 'email' | 'whatsapp' | 'sms';
  name: string;
  category: string | null;
  language: string;
  folder: string | null;
  tags: string[] | null;
  providerTemplateId: string | null;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';
  currentDraftVersionId: number | null;
  currentPublishedVersionId: number | null;
  ownerId: number;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmMessageTemplatesCreationAttributes extends Optional<CrmMessageTemplatesAttributes,
  'id' | 'branchId' | 'category' | 'language' | 'folder' | 'tags' | 'providerTemplateId' | 'status' | 'currentDraftVersionId' | 'currentPublishedVersionId' | 'isDeleted' | 'deletedAt' | 'createdAt' | 'updatedAt'> {}

class CrmMessageTemplates extends Model<CrmMessageTemplatesAttributes, CrmMessageTemplatesCreationAttributes> implements CrmMessageTemplatesAttributes {
  declare id: number;
  declare branchId: number | null;
  declare channel: 'email' | 'whatsapp' | 'sms';
  declare name: string;
  declare category: string | null;
  declare language: string;
  declare folder: string | null;
  declare tags: string[] | null;
  declare providerTemplateId: string | null;
  declare status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';
  declare currentDraftVersionId: number | null;
  declare currentPublishedVersionId: number | null;
  declare ownerId: number;
  declare isDeleted: boolean;
  declare deletedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmMessageTemplates.belongsTo(models.CrmBranch, { foreignKey: 'branch_id', targetKey: 'id', as: 'dmBranch' });
    CrmMessageTemplates.belongsTo(models.CrmEmployee, { foreignKey: 'owner_id', targetKey: 'id', as: 'ownerEmployee' });
    CrmMessageTemplates.hasMany(models.CrmMessageTemplateVersions, { foreignKey: 'template_id', sourceKey: 'id', as: 'versions' });
    CrmMessageTemplates.hasMany(models.CrmMessageTemplateStatusEvents, { foreignKey: 'template_id', sourceKey: 'id', as: 'statusEvents' });
  }
}

CrmMessageTemplates.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id', references: { model: 'crm_branch', key: 'id' } },
    channel: { type: DataTypes.ENUM('email', 'whatsapp', 'sms'), allowNull: false, field: 'channel' },
    name: { type: DataTypes.STRING(255), allowNull: false, field: 'name' },
    category: { type: DataTypes.STRING(50), allowNull: true, field: 'category' },
    language: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'en', field: 'language' },
    folder: { type: DataTypes.STRING(255), allowNull: true, field: 'folder' },
    tags: { type: DataTypes.JSON, allowNull: true, field: 'tags' },
    providerTemplateId: { type: DataTypes.STRING(128), allowNull: true, field: 'provider_template_id' },
    status: { type: DataTypes.ENUM('draft', 'pending_review', 'approved', 'rejected', 'archived'), allowNull: false, defaultValue: 'draft', field: 'status' },
    currentDraftVersionId: { type: DataTypes.INTEGER, allowNull: true, field: 'current_draft_version_id' },
    currentPublishedVersionId: { type: DataTypes.INTEGER, allowNull: true, field: 'current_published_version_id' },
    ownerId: { type: DataTypes.INTEGER, allowNull: false, field: 'owner_id', references: { model: 'crm_employee', key: 'id' } },
    isDeleted: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'is_deleted' },
    deletedAt: { type: DataTypes.DATE, allowNull: true, field: 'deleted_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmMessageTemplates',
    tableName: 'crm_message_templates',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmMessageTemplates };
export type { CrmMessageTemplatesAttributes, CrmMessageTemplatesCreationAttributes };
