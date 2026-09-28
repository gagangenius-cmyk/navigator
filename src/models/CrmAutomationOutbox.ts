import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmAutomationOutboxAttributes {
  id: number;
  eventType: string;
  aggregateType: string;
  aggregateId: number;
  payload: Record<string, unknown>;
  dedupeKey: string;
  publishState: 'pending' | 'published' | 'failed';
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lastError: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

interface CrmAutomationOutboxCreationAttributes extends Optional<CrmAutomationOutboxAttributes,
  'id' | 'publishState' | 'attempts' | 'maxAttempts' | 'runAfter' | 'lastError' | 'publishedAt' | 'createdAt'> {}

class CrmAutomationOutbox extends Model<CrmAutomationOutboxAttributes, CrmAutomationOutboxCreationAttributes> implements CrmAutomationOutboxAttributes {
  declare id: number;
  declare eventType: string;
  declare aggregateType: string;
  declare aggregateId: number;
  declare payload: Record<string, unknown>;
  declare dedupeKey: string;
  declare publishState: 'pending' | 'published' | 'failed';
  declare attempts: number;
  declare maxAttempts: number;
  declare runAfter: Date;
  declare lastError: string | null;
  declare publishedAt: Date | null;
  declare createdAt: Date;

  public static associate(_models: any) {
    // aggregate_id is polymorphic (points at whichever table aggregate_type
    // names) so it is intentionally not a belongsTo association.
  }
}

CrmAutomationOutbox.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    eventType: { type: DataTypes.STRING(100), allowNull: false, field: 'event_type' },
    aggregateType: { type: DataTypes.STRING(50), allowNull: false, field: 'aggregate_type' },
    aggregateId: { type: DataTypes.INTEGER, allowNull: false, field: 'aggregate_id' },
    payload: { type: DataTypes.JSON, allowNull: false, field: 'payload' },
    dedupeKey: { type: DataTypes.CHAR(64), allowNull: false, field: 'dedupe_key' },
    publishState: { type: DataTypes.ENUM('pending', 'published', 'failed'), allowNull: false, defaultValue: 'pending', field: 'publish_state' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'attempts' },
    maxAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5, field: 'max_attempts' },
    runAfter: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'run_after' },
    lastError: { type: DataTypes.TEXT, allowNull: true, field: 'last_error' },
    publishedAt: { type: DataTypes.DATE, allowNull: true, field: 'published_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  {
    sequelize,
    modelName: 'CrmAutomationOutbox',
    tableName: 'crm_automation_outbox',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmAutomationOutbox };
export type { CrmAutomationOutboxAttributes, CrmAutomationOutboxCreationAttributes };
