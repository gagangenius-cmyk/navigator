import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmContactSegmentsAttributes {
  id: number;
  branchId: number | null;
  name: string;
  description: string | null;
  filterAst: Record<string, unknown>;
  ownerId: number;
  isShared: boolean;
  lastEstimatedCount: number | null;
  lastEstimatedAt: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmContactSegmentsCreationAttributes extends Optional<CrmContactSegmentsAttributes,
  'id' | 'branchId' | 'description' | 'isShared' | 'lastEstimatedCount' | 'lastEstimatedAt' | 'isDeleted' | 'deletedAt' | 'createdAt' | 'updatedAt'> {}

class CrmContactSegments extends Model<CrmContactSegmentsAttributes, CrmContactSegmentsCreationAttributes> implements CrmContactSegmentsAttributes {
  declare id: number;
  declare branchId: number | null;
  declare name: string;
  declare description: string | null;
  declare filterAst: Record<string, unknown>;
  declare ownerId: number;
  declare isShared: boolean;
  declare lastEstimatedCount: number | null;
  declare lastEstimatedAt: Date | null;
  declare isDeleted: boolean;
  declare deletedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmContactSegments.belongsTo(models.CrmBranch, { foreignKey: 'branch_id', targetKey: 'id', as: 'dmBranch' });
    CrmContactSegments.belongsTo(models.CrmEmployee, { foreignKey: 'owner_id', targetKey: 'id', as: 'ownerEmployee' });
    CrmContactSegments.hasMany(models.CrmBroadcastCampaigns, { foreignKey: 'segment_id', sourceKey: 'id', as: 'campaigns' });
  }
}

CrmContactSegments.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id', references: { model: 'crm_branch', key: 'id' } },
    name: { type: DataTypes.STRING(255), allowNull: false, field: 'name' },
    description: { type: DataTypes.TEXT, allowNull: true, field: 'description' },
    filterAst: { type: DataTypes.JSON, allowNull: false, field: 'filter_ast' },
    ownerId: { type: DataTypes.INTEGER, allowNull: false, field: 'owner_id', references: { model: 'crm_employee', key: 'id' } },
    isShared: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'is_shared' },
    lastEstimatedCount: { type: DataTypes.INTEGER, allowNull: true, field: 'last_estimated_count' },
    lastEstimatedAt: { type: DataTypes.DATE, allowNull: true, field: 'last_estimated_at' },
    isDeleted: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'is_deleted' },
    deletedAt: { type: DataTypes.DATE, allowNull: true, field: 'deleted_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmContactSegments',
    tableName: 'crm_contact_segments',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmContactSegments };
export type { CrmContactSegmentsAttributes, CrmContactSegmentsCreationAttributes };
