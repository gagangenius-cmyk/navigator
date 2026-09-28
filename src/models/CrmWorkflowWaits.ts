import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmWorkflowWaitsAttributes {
  id: number;
  enrollmentId: number;
  stepExecutionId: number;
  waitType: 'duration' | 'until' | 'event';
  eventCorrelationKey: string | null;
  deadlineAt: Date | null;
  timeoutAction: 'fail' | 'skip' | 'continue_via_timeout_branch';
  status: 'waiting' | 'resumed' | 'timed_out' | 'cancelled';
  resumedAt: Date | null;
  resumedByEventId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CrmWorkflowWaitsCreationAttributes extends Optional<CrmWorkflowWaitsAttributes,
  'id' | 'eventCorrelationKey' | 'deadlineAt' | 'timeoutAction' | 'status' | 'resumedAt' | 'resumedByEventId' | 'createdAt' | 'updatedAt'> {}

class CrmWorkflowWaits extends Model<CrmWorkflowWaitsAttributes, CrmWorkflowWaitsCreationAttributes> implements CrmWorkflowWaitsAttributes {
  declare id: number;
  declare enrollmentId: number;
  declare stepExecutionId: number;
  declare waitType: 'duration' | 'until' | 'event';
  declare eventCorrelationKey: string | null;
  declare deadlineAt: Date | null;
  declare timeoutAction: 'fail' | 'skip' | 'continue_via_timeout_branch';
  declare status: 'waiting' | 'resumed' | 'timed_out' | 'cancelled';
  declare resumedAt: Date | null;
  declare resumedByEventId: number | null;
  declare createdAt: Date;
  declare updatedAt: Date;

  public static associate(models: any) {
    CrmWorkflowWaits.belongsTo(models.CrmWorkflowEnrollments, { foreignKey: 'enrollment_id', targetKey: 'id', as: 'enrollment' });
    CrmWorkflowWaits.belongsTo(models.CrmWorkflowStepExecutions, { foreignKey: 'step_execution_id', targetKey: 'id', as: 'stepExecution' });
  }
}

CrmWorkflowWaits.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    enrollmentId: { type: DataTypes.INTEGER, allowNull: false, field: 'enrollment_id', references: { model: 'crm_workflow_enrollments', key: 'id' } },
    stepExecutionId: { type: DataTypes.INTEGER, allowNull: false, field: 'step_execution_id', references: { model: 'crm_workflow_step_executions', key: 'id' } },
    waitType: { type: DataTypes.ENUM('duration', 'until', 'event'), allowNull: false, field: 'wait_type' },
    eventCorrelationKey: { type: DataTypes.STRING(191), allowNull: true, field: 'event_correlation_key' },
    deadlineAt: { type: DataTypes.DATE, allowNull: true, field: 'deadline_at' },
    timeoutAction: { type: DataTypes.ENUM('fail', 'skip', 'continue_via_timeout_branch'), allowNull: false, defaultValue: 'continue_via_timeout_branch', field: 'timeout_action' },
    status: { type: DataTypes.ENUM('waiting', 'resumed', 'timed_out', 'cancelled'), allowNull: false, defaultValue: 'waiting', field: 'status' },
    resumedAt: { type: DataTypes.DATE, allowNull: true, field: 'resumed_at' },
    resumedByEventId: { type: DataTypes.INTEGER, allowNull: true, field: 'resumed_by_event_id' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  {
    sequelize,
    modelName: 'CrmWorkflowWaits',
    tableName: 'crm_workflow_waits',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmWorkflowWaits };
export type { CrmWorkflowWaitsAttributes, CrmWorkflowWaitsCreationAttributes };
