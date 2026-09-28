import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmWorkflowStepExecutionsAttributes {
  id: number;
  enrollmentId: number;
  nodeId: string;
  nodeType: string;
  attempt: number;
  status: 'pending' | 'claimed' | 'waiting' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  inputSnapshot: Record<string, unknown> | null;
  outputSnapshot: Record<string, unknown> | null;
  idempotencyKey: string;
  claimedAt: Date | null;
  claimedBy: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

interface CrmWorkflowStepExecutionsCreationAttributes extends Optional<CrmWorkflowStepExecutionsAttributes,
  'id' | 'attempt' | 'status' | 'inputSnapshot' | 'outputSnapshot' | 'claimedAt' | 'claimedBy' | 'errorMessage' | 'startedAt' | 'completedAt' | 'createdAt'> {}

class CrmWorkflowStepExecutions extends Model<CrmWorkflowStepExecutionsAttributes, CrmWorkflowStepExecutionsCreationAttributes> implements CrmWorkflowStepExecutionsAttributes {
  declare id: number;
  declare enrollmentId: number;
  declare nodeId: string;
  declare nodeType: string;
  declare attempt: number;
  declare status: 'pending' | 'claimed' | 'waiting' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  declare inputSnapshot: Record<string, unknown> | null;
  declare outputSnapshot: Record<string, unknown> | null;
  declare idempotencyKey: string;
  declare claimedAt: Date | null;
  declare claimedBy: string | null;
  declare errorMessage: string | null;
  declare startedAt: Date | null;
  declare completedAt: Date | null;
  declare createdAt: Date;

  public static associate(models: any) {
    CrmWorkflowStepExecutions.belongsTo(models.CrmWorkflowEnrollments, { foreignKey: 'enrollment_id', targetKey: 'id', as: 'enrollment' });
    CrmWorkflowStepExecutions.hasMany(models.CrmWorkflowWaits, { foreignKey: 'step_execution_id', sourceKey: 'id', as: 'waits' });
  }
}

CrmWorkflowStepExecutions.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    enrollmentId: { type: DataTypes.INTEGER, allowNull: false, field: 'enrollment_id', references: { model: 'crm_workflow_enrollments', key: 'id' } },
    nodeId: { type: DataTypes.STRING(191), allowNull: false, field: 'node_id' },
    nodeType: { type: DataTypes.STRING(100), allowNull: false, field: 'node_type' },
    attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'attempt' },
    status: { type: DataTypes.ENUM('pending', 'claimed', 'waiting', 'succeeded', 'failed', 'skipped', 'cancelled'), allowNull: false, defaultValue: 'pending', field: 'status' },
    inputSnapshot: { type: DataTypes.JSON, allowNull: true, field: 'input_snapshot' },
    outputSnapshot: { type: DataTypes.JSON, allowNull: true, field: 'output_snapshot' },
    idempotencyKey: { type: DataTypes.CHAR(64), allowNull: false, field: 'idempotency_key' },
    claimedAt: { type: DataTypes.DATE, allowNull: true, field: 'claimed_at' },
    claimedBy: { type: DataTypes.STRING(100), allowNull: true, field: 'claimed_by' },
    errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
    startedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
    completedAt: { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  {
    sequelize,
    modelName: 'CrmWorkflowStepExecutions',
    tableName: 'crm_workflow_step_executions',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmWorkflowStepExecutions };
export type { CrmWorkflowStepExecutionsAttributes, CrmWorkflowStepExecutionsCreationAttributes };
