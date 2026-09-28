import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmWorkflowVersionsAttributes {
  id: number;
  workflowId: number;
  versionNumber: number;
  graphJson: unknown;
  schemaVersion: string;
  validationHash: string;
  isPublished: boolean;
  publishedAt: Date | null;
  createdBy: number;
  createdAt: Date;
}

interface CrmWorkflowVersionsCreationAttributes extends Optional<CrmWorkflowVersionsAttributes,
  'id' | 'schemaVersion' | 'isPublished' | 'publishedAt' | 'createdAt'> {}

class CrmWorkflowVersions extends Model<CrmWorkflowVersionsAttributes, CrmWorkflowVersionsCreationAttributes> implements CrmWorkflowVersionsAttributes {
  declare id: number;
  declare workflowId: number;
  declare versionNumber: number;
  declare graphJson: unknown;
  declare schemaVersion: string;
  declare validationHash: string;
  declare isPublished: boolean;
  declare publishedAt: Date | null;
  declare createdBy: number;
  declare createdAt: Date;

  public static associate(models: any) {
    CrmWorkflowVersions.belongsTo(models.CrmWorkflowDefinitions, { foreignKey: 'workflow_id', targetKey: 'id', as: 'workflow' });
    CrmWorkflowVersions.belongsTo(models.CrmEmployee, { foreignKey: 'created_by', targetKey: 'id', as: 'createdEmployee' });
    CrmWorkflowVersions.hasMany(models.CrmWorkflowEnrollments, { foreignKey: 'workflow_version_id', sourceKey: 'id', as: 'enrollments' });
    CrmWorkflowVersions.hasMany(models.CrmBotSessions, { foreignKey: 'workflow_version_id', sourceKey: 'id', as: 'botSessions' });
  }
}

CrmWorkflowVersions.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    workflowId: { type: DataTypes.INTEGER, allowNull: false, field: 'workflow_id', references: { model: 'crm_workflow_definitions', key: 'id' } },
    versionNumber: { type: DataTypes.INTEGER, allowNull: false, field: 'version_number' },
    graphJson: { type: DataTypes.JSON, allowNull: false, field: 'graph_json' },
    schemaVersion: { type: DataTypes.STRING(20), allowNull: false, defaultValue: '1.0', field: 'schema_version' },
    validationHash: { type: DataTypes.CHAR(64), allowNull: false, field: 'validation_hash' },
    isPublished: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'is_published' },
    publishedAt: { type: DataTypes.DATE, allowNull: true, field: 'published_at' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'created_by', references: { model: 'crm_employee', key: 'id' } },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  {
    sequelize,
    modelName: 'CrmWorkflowVersions',
    tableName: 'crm_workflow_versions',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmWorkflowVersions };
export type { CrmWorkflowVersionsAttributes, CrmWorkflowVersionsCreationAttributes };
