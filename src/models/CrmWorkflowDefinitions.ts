import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmWorkflowDefinitionsAttributes {
  id: number;
  branchId: number | null;
  workflowType: 'automation' | 'bot';
  name: string;
  description: string | null;
  status: 'draft' | 'published' | 'archived';
  currentDraftVersionId: number | null;
  currentPublishedVersionId: number | null;
  ownerId: number;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmWorkflowDefinitionsCreationAttributes extends Optional<CrmWorkflowDefinitionsAttributes,
  'id' | 'branchId' | 'description' | 'status' | 'currentDraftVersionId' | 'currentPublishedVersionId' | 'isDeleted' | 'deletedAt' | 'createdAt' | 'updatedAt'> {}

class CrmWorkflowDefinitions extends Model<CrmWorkflowDefinitionsAttributes, CrmWorkflowDefinitionsCreationAttributes> implements CrmWorkflowDefinitionsAttributes {
  declare id: number;
  declare branchId: number | null;
  declare workflowType: 'automation' | 'bot';
  declare name: string;
  declare description: string | null;
  declare status: 'draft' | 'published' | 'archived';
  declare currentDraftVersionId: number | null;
  declare currentPublishedVersionId: number | null;
  declare ownerId: number;
  declare isDeleted: boolean;
  declare deletedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmWorkflowDefinitions.belongsTo(models.CrmBranch, { foreignKey: 'branch_id', targetKey: 'id', as: 'dmBranch' });
    CrmWorkflowDefinitions.belongsTo(models.CrmEmployee, { foreignKey: 'owner_id', targetKey: 'id', as: 'ownerEmployee' });
    CrmWorkflowDefinitions.hasMany(models.CrmWorkflowVersions, { foreignKey: 'workflow_id', sourceKey: 'id', as: 'versions' });
  }
}

CrmWorkflowDefinitions.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id', references: { model: 'crm_branch', key: 'id' } },
    workflowType: { type: DataTypes.ENUM('automation', 'bot'), allowNull: false, defaultValue: 'automation', field: 'workflow_type' },
    name: { type: DataTypes.STRING(255), allowNull: false, field: 'name' },
    description: { type: DataTypes.TEXT, allowNull: true, field: 'description' },
    status: { type: DataTypes.ENUM('draft', 'published', 'archived'), allowNull: false, defaultValue: 'draft', field: 'status' },
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
    modelName: 'CrmWorkflowDefinitions',
    tableName: 'crm_workflow_definitions',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmWorkflowDefinitions };
export type { CrmWorkflowDefinitionsAttributes, CrmWorkflowDefinitionsCreationAttributes };
