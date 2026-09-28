import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmAutomationAuditLogsAttributes {
  id: number;
  actorId: number | null;
  action: string;
  branchId: number | null;
  objectType: string;
  objectId: number;
  metadata: Record<string, unknown> | null;
  occurredAt: Date;
}

interface CrmAutomationAuditLogsCreationAttributes extends Optional<CrmAutomationAuditLogsAttributes,
  'id' | 'actorId' | 'branchId' | 'metadata' | 'occurredAt'> {}

class CrmAutomationAuditLogs extends Model<CrmAutomationAuditLogsAttributes, CrmAutomationAuditLogsCreationAttributes> implements CrmAutomationAuditLogsAttributes {
  declare id: number;
  declare actorId: number | null;
  declare action: string;
  declare branchId: number | null;
  declare objectType: string;
  declare objectId: number;
  declare metadata: Record<string, unknown> | null;
  declare occurredAt: Date;

  public static associate(models: any) {
    CrmAutomationAuditLogs.belongsTo(models.CrmEmployee, { foreignKey: 'actor_id', targetKey: 'id', as: 'actorEmployee' });
    CrmAutomationAuditLogs.belongsTo(models.CrmBranch, { foreignKey: 'branch_id', targetKey: 'id', as: 'dmBranch' });
  }
}

CrmAutomationAuditLogs.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    actorId: { type: DataTypes.INTEGER, allowNull: true, field: 'actor_id', references: { model: 'crm_employee', key: 'id' } },
    action: { type: DataTypes.STRING(100), allowNull: false, field: 'action' },
    branchId: { type: DataTypes.INTEGER, allowNull: true, field: 'branch_id', references: { model: 'crm_branch', key: 'id' } },
    objectType: { type: DataTypes.STRING(50), allowNull: false, field: 'object_type' },
    objectId: { type: DataTypes.INTEGER, allowNull: false, field: 'object_id' },
    metadata: { type: DataTypes.JSON, allowNull: true, field: 'metadata' },
    occurredAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'occurred_at' },
  },
  {
    sequelize,
    modelName: 'CrmAutomationAuditLogs',
    tableName: 'crm_automation_audit_logs',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmAutomationAuditLogs };
export type { CrmAutomationAuditLogsAttributes, CrmAutomationAuditLogsCreationAttributes };
