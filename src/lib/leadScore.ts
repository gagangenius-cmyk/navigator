import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';

// Rule-based lead scoring - deliberately NOT a trained model. crm_opportunities
// has zero rows in this database (checked directly before building this): no
// lead has ever been recorded converting to a client through the pipeline, so
// there is no historical outcome to fit a logistic regression or empirical
// conversion-rate model against. This scores leads from business-legible
// rules over fields already in the CRM instead, with every contributing
// factor returned in `reasons` so a counsellor can see *why* a lead scored
// the way it did, not just a black-box number. Revisit with a real
// statistical model once opportunities/conversions actually start
// accumulating - the data to do that properly doesn't exist yet.
//
// Grounded in what this dataset actually looks like today (spot-checked
// before writing the weights below): `priority` is "Medium" for 458/459 rows
// and `lead_quality` is "Warm" for all 459 - both fields are effectively
// unused/never triaged in practice, so they're included (for when they do
// get used) but weighted lower than the two signals that actually vary here:
// free-text `status` (most rows are messy legacy text like "no answer
// messaged on whatsapp" rather than the clean admin-configured Hot/Warm/Cold/
// Junk/Dead/DNP/Enrolled list) and recency of logged activity.

export interface LeadScoreInput {
  status: string | null;
  priority: string | null;
  leadQuality: string | null;
  assignTo: number | null;
  lastActivityAt: Date | null;
}

export interface LeadScoreResult {
  score: number;
  label: 'Hot' | 'Warm' | 'Cold';
  reasons: string[];
}

// Substring match against free-text status, case-insensitive - this dataset's
// real status values are legacy free text ("he is not interested", "wrong
// number messaged on whatsapp"), not the clean configured dropdown, so an
// exact-match-only classifier would leave almost every row unclassified.
const NEGATIVE_STATUS_PHRASES = [
  'not interested', 'no interest', 'wrong number', 'invalid', 'no answer',
  'not_answer', 'could not connect', 'junk', 'dead', 'duplicate', 'dnp', 'dnq',
];
const TERMINAL_CLIENT_PHRASES = ['enrolled', 'client', 'retained', 'converted'];

function scorePriority(priority: string | null): { points: number; reason: string | null } {
  const p = (priority || '').trim().toLowerCase();
  if (p === 'hot' || p === 'p1') return { points: 15, reason: 'High priority (+15)' };
  if (p === 'high') return { points: 15, reason: 'High priority (+15)' };
  if (p === 'medium' || p === 'p2') return { points: 5, reason: null }; // the overwhelming default - not worth surfacing as a "reason"
  if (p === 'low' || p === 'p3') return { points: -5, reason: 'Low priority (-5)' };
  if (p === 'p4') return { points: -10, reason: 'P4 priority (-10)' };
  return { points: 0, reason: null };
}

function scoreLeadQuality(leadQuality: string | null): { points: number; reason: string | null } {
  const q = (leadQuality || '').trim().toLowerCase();
  if (q === 'hot') return { points: 15, reason: 'Marked Hot quality (+15)' };
  if (q === 'warm') return { points: 5, reason: null }; // the overwhelming default here too
  if (q === 'cold') return { points: -15, reason: 'Marked Cold quality (-15)' };
  return { points: 0, reason: null };
}

function scoreStatus(status: string | null): { points: number; reason: string | null; terminalNegative: boolean; terminalClient: boolean } {
  const s = (status || '').trim().toLowerCase();
  if (!s) return { points: 0, reason: null, terminalNegative: false, terminalClient: false };

  if (TERMINAL_CLIENT_PHRASES.some((phrase) => s.includes(phrase))) {
    return { points: 0, reason: 'Already a client/enrolled', terminalNegative: false, terminalClient: true };
  }
  if (NEGATIVE_STATUS_PHRASES.some((phrase) => s.includes(phrase))) {
    return { points: -40, reason: `Status suggests low interest ("${status}") (-40)`, terminalNegative: true, terminalClient: false };
  }
  if (s === 'hot') return { points: 20, reason: 'Status: Hot (+20)', terminalNegative: false, terminalClient: false };
  if (s === 'warm') return { points: 8, reason: 'Status: Warm (+8)', terminalNegative: false, terminalClient: false };
  if (s === 'cold') return { points: -10, reason: 'Status: Cold (-10)', terminalNegative: false, terminalClient: false };
  return { points: 0, reason: null, terminalNegative: false, terminalClient: false };
}

function scoreActivityRecency(lastActivityAt: Date | null): { points: number; reason: string } {
  if (!lastActivityAt) return { points: -20, reason: 'No logged activity yet (-20)' };
  const days = Math.floor((Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 3) return { points: 20, reason: `Active in the last ${days <= 1 ? 'day' : `${days} days`} (+20)` };
  if (days <= 7) return { points: 10, reason: 'Active in the last week (+10)' };
  if (days <= 30) return { points: 0, reason: 'No activity in over a week' };
  return { points: -15, reason: `No activity in ${days} days (-15)` };
}

export function computeLeadScore(input: LeadScoreInput): LeadScoreResult | null {
  const statusResult = scoreStatus(input.status);
  // Already a client/enrolled - scoring it as a "lead" is moot; caller should
  // exclude these rather than show a meaningless score.
  if (statusResult.terminalClient) return null;

  const priorityResult = scorePriority(input.priority);
  const qualityResult = scoreLeadQuality(input.leadQuality);
  const activityResult = scoreActivityRecency(input.lastActivityAt);

  const reasons = [statusResult.reason, priorityResult.reason, qualityResult.reason, activityResult.reason]
    .filter((r): r is string => Boolean(r));

  let points = 50 + statusResult.points + priorityResult.points + qualityResult.points + activityResult.points;
  if (!input.assignTo) {
    points -= 10;
    reasons.push('Not yet assigned to anyone (-10)');
  }

  const score = Math.max(0, Math.min(100, Math.round(points)));
  const label: LeadScoreResult['label'] = statusResult.terminalNegative
    ? 'Cold'
    : score >= 70 ? 'Hot' : score >= 45 ? 'Warm' : 'Cold';

  return { score, label, reasons };
}

let tableReady: Promise<void> | null = null;

// Exported so callers that JOIN crm_lead_scores (e.g. GET /api/leads) can
// ensure it exists before the cron has ever run a first pass.
export const ensureLeadScoreTable = async () => {
  if (!tableReady) {
    tableReady = sequelize.query(`
      CREATE TABLE IF NOT EXISTS crm_lead_scores (
        lead_id INT NOT NULL PRIMARY KEY,
        score INT NOT NULL,
        label VARCHAR(20) NOT NULL,
        reasons JSON NULL,
        computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_lead_scores_score (score),
        INDEX idx_lead_scores_label (label)
      )
    `).then(() => undefined).catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  await tableReady;
};

interface ScorableLeadRow {
  id: number;
  status: string | null;
  priority: string | null;
  lead_quality: string | null;
  assignTo: number | null;
  last_activity_at: string | null;
}

// Batch refresh, matching runSlaSweep()'s shape (src/lib/leadPool.ts) - one
// pass over every open lead, called from the lead-score cron tick. Skips
// leads that already have an opportunity (HAS_OPP_SQL-equivalent, simplified)
// since a lead actively in the sales pipeline isn't what this is for.
export async function refreshLeadScores(): Promise<{ scored: number; skipped: number }> {
  await ensureLeadScoreTable();

  const rows = await sequelize.query<ScorableLeadRow>(
    `SELECT l.id, l.status, l.priority, l.lead_quality, l.assignTo,
            (SELECT MAX(cr.created_at) FROM crm_remarks cr WHERE cr.lead_id = l.id) AS last_activity_at
     FROM crm_forum_leads l
     WHERE (l.opportunity_id IS NULL OR l.opportunity_id = 0)
       AND COALESCE(l.opportunity_status, '') <> 'draft'
       AND NOT EXISTS (SELECT 1 FROM crm_opportunities o WHERE o.leadId = l.id AND o.is_deleted = 0)`,
    { type: QueryTypes.SELECT }
  );

  let scored = 0;
  let skipped = 0;

  for (const row of rows) {
    const result = computeLeadScore({
      status: row.status,
      priority: row.priority,
      leadQuality: row.lead_quality,
      assignTo: row.assignTo,
      lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at) : null,
    });

    if (!result) {
      skipped += 1;
      continue;
    }

    await sequelize.query(
      `INSERT INTO crm_lead_scores (lead_id, score, label, reasons, computed_at)
       VALUES (:leadId, :score, :label, :reasons, NOW())
       ON DUPLICATE KEY UPDATE score = VALUES(score), label = VALUES(label), reasons = VALUES(reasons), computed_at = NOW()`,
      {
        replacements: {
          leadId: row.id,
          score: result.score,
          label: result.label,
          reasons: JSON.stringify(result.reasons),
        },
      }
    );
    scored += 1;
  }

  return { scored, skipped };
}
