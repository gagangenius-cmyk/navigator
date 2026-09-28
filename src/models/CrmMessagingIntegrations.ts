import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmMessagingIntegrationsAttributes {
  id: number;
  branchId: number | null;
  channel: 'email' | 'whatsapp' | 'sms';
  provider: string;
  accountLabel: string;
  accountMetadata: Record<string, unknown> | null;
  credentialRef: string | null;
  capabilities: Record<string, unknown> | null;
  status: 'active' | 'disabled' | 'error';
  lastHealthCheckAt: Date | null;
  lastHealthStatus: string | null;
  createdBy: number;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmMessagingIntegrationsCreationAttributes extends Optional<CrmMessagingIntegrationsAttributes,
  'id' | 'branchId' | 'accountMetadata' | 'credentialRef' | 'capabilities' | 'status' | 'lastHealthCheckAt' | 'lastHealthStatus' | 'isDeleted' | 'deletedAt' | 'createdAt' | 'updatedAt'> {}

class CrmMessagingIntegrations extends Model<CrmMessagingIntegrationsAttributes, CrmMessagingIntegrationsCreationAttributes> implements CrmMessagingIntegrationsAttributes {
  declare id: number;
  declare branchId: number | null;
  declare channel: 'email' | 'whatsapp' | 'sms';
  declare provider: string;
  declare accountLabel: string;
  declare accountMetadata: Record<string, unknown> | null;
  declare credentialRef: string | null;
  declare capabilities: Record<string, unknown> | null;
  declare status: 'active' | 'disabled' | 'error';
  declare lastHealthCheckAt: Date | null;
  declare lastHealthStatus: string | null;
  declare createdBy: number;
  declare isDeleted: boolean;
  declare deletedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmMessagingIntegrations.belongsTo(models.CrmBranch, { foreignKey: 'branch_id', targetKey: 'id', as: 'dmBranch' });
    CrmMessagingIntegrations.belongsTo(models.CrmEmployee, { foreignKey: 'created_by', targetKey: 'id', as: 'createdEmployee' });
  }
}

CrmMessagingIntegrations.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id', references: { model: 'crm_branch', key: 'id' } },
    channel: { type: DataTypes.ENUM('email', 'whatsapp', 'sms'), allowNull: false, field: 'channel' },
    provider: { type: DataTypes.STRING(50), allowNull: false, field: 'provider' },
    accountLabel: { type: DataTypes.STRING(255), allowNull: false, field: 'account_label' },
    accountMetadata: { type: DataTypes.JSON, allowNull: true, field: 'account_metadata' },
    credentialRef: { type: DataTypes.TEXT, allowNull: true, field: 'credential_ref' },
    capabilities: { type: DataTypes.JSON, allowNull: true, field: 'capabilities' },
    status: { type: DataTypes.ENUM('active', 'disabled', 'error'), allowNull: false, defaultValue: 'active', field: 'status' },
    lastHealthCheckAt: { type: DataTypes.DATE, allowNull: true, field: 'last_health_check_at' },
    lastHealthStatus: { type: DataTypes.STRING(50), allowNull: true, field: 'last_health_status' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'created_by', references: { model: 'crm_employee', key: 'id' } },
    isDeleted: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0, field: 'is_deleted' },
    deletedAt: { type: DataTypes.DATE, allowNull: true, field: 'deleted_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmMessagingIntegrations',
    tableName: 'crm_messaging_integrations',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmMessagingIntegrations };
export type { CrmMessagingIntegrationsAttributes, CrmMessagingIntegrationsCreationAttributes };
