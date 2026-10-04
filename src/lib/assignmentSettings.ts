import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';

// Not imported from leadPool.ts to avoid a circular import (leadPool.ts
// imports getAssignmentSettings from this file) - this is only the seed
// value for a brand-new install's first row, so duplicating the literal
// (matching leadPool.ts's own DEFAULT_SLA_MINUTES) is harmless.
const SEED_POOL_SLA_MINUTES = 30;

// Server-only (imports sequelize). Single-row, self-provisioning settings
// table - same pattern as src/lib/discountTierConfig.ts: CREATE TABLE IF NOT
// EXISTS + INSERT ... ON DUPLICATE KEY UPDATE id = id to seed defaults once,
// memoized readiness promise so concurrent callers share one in-flight DDL.
//
// These are the CEO-facing controls over the automatic lead-routing engine
// (src/lib/assignmentRuleEngine.ts) and its cron safety net
// (src/lib/lead-pool-sla-cron.ts) - previously a hardcoded env var
// (LEAD_POOL_SLA_MINUTES) and no way to pause either without a deploy.

export interface AssignmentSettings {
  roundRobinEnabled: boolean;
  slaSweepEnabled: boolean;
  poolSlaMinutes: number;
  updatedAt: string | null;
  updatedBy: number | null;
}

const DEFAULT_SETTINGS: Omit<AssignmentSettings, 'updatedAt' | 'updatedBy'> = {
  roundRobinEnabled: true,
  slaSweepEnabled: true,
  poolSlaMinutes: SEED_POOL_SLA_MINUTES,
};

let tableReady: Promise<void> | null = null;

async function ensureAssignmentSettingsTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_assignment_settings (
          id INT NOT NULL PRIMARY KEY DEFAULT 1,
          round_robin_enabled TINYINT NOT NULL DEFAULT 1,
          sla_sweep_enabled TINYINT NOT NULL DEFAULT 1,
          pool_sla_minutes INT NOT NULL DEFAULT 30,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          updated_by INT NULL
        )
      `);
      // LEAD_POOL_SLA_MINUTES stays as the seed default on first install only
      // (matching how discountTierConfig.ts seeds from a code constant) - once
      // this row exists, the env var is never consulted again.
      await sequelize.query(`
        INSERT INTO crm_assignment_settings (id, round_robin_enabled, sla_sweep_enabled, pool_sla_minutes)
        VALUES (1, 1, 1, :poolSlaMinutes)
        ON DUPLICATE KEY UPDATE id = id
      `, {
        replacements: { poolSlaMinutes: DEFAULT_SETTINGS.poolSlaMinutes },
      });
    })().catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  await tableReady;
}

export async function getAssignmentSettings(): Promise<AssignmentSettings> {
  await ensureAssignmentSettingsTable();
  const [row] = await sequelize.query<{
    round_robin_enabled: number; sla_sweep_enabled: number; pool_sla_minutes: number;
    updated_at: string | null; updated_by: number | null;
  }>(
    'SELECT round_robin_enabled, sla_sweep_enabled, pool_sla_minutes, updated_at, updated_by FROM crm_assignment_settings WHERE id = 1 LIMIT 1',
    { type: QueryTypes.SELECT }
  );
  if (!row) return { ...DEFAULT_SETTINGS, updatedAt: null, updatedBy: null };
  return {
    roundRobinEnabled: Boolean(row.round_robin_enabled),
    slaSweepEnabled: Boolean(row.sla_sweep_enabled),
    poolSlaMinutes: Number(row.pool_sla_minutes),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export async function updateAssignmentSettings(
  input: { roundRobinEnabled?: boolean; slaSweepEnabled?: boolean; poolSlaMinutes?: number },
  updatedBy: number | null
): Promise<AssignmentSettings> {
  if (input.poolSlaMinutes !== undefined && (!Number.isFinite(input.poolSlaMinutes) || input.poolSlaMinutes < 1)) {
    throw new Error('SLA minutes must be a positive number');
  }

  await ensureAssignmentSettingsTable();
  const current = await getAssignmentSettings();
  const merged = {
    roundRobinEnabled: input.roundRobinEnabled ?? current.roundRobinEnabled,
    slaSweepEnabled: input.slaSweepEnabled ?? current.slaSweepEnabled,
    poolSlaMinutes: input.poolSlaMinutes ?? current.poolSlaMinutes,
  };

  await sequelize.query(`
    UPDATE crm_assignment_settings
    SET round_robin_enabled = :roundRobinEnabled, sla_sweep_enabled = :slaSweepEnabled,
        pool_sla_minutes = :poolSlaMinutes, updated_by = :updatedBy
    WHERE id = 1
  `, {
    replacements: {
      roundRobinEnabled: merged.roundRobinEnabled ? 1 : 0,
      slaSweepEnabled: merged.slaSweepEnabled ? 1 : 0,
      poolSlaMinutes: merged.poolSlaMinutes,
      updatedBy,
    },
  });

  return getAssignmentSettings();
}
