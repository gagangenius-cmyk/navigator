// Resolves Annexure A's fee table (WorkPermitAgreementTemplate.ts) from the
// existing crm_fee rate card, instead of requiring it to be typed in by hand
// per agreement. crm_fee already models exactly the two plan shapes the
// signed PDF shows — an "Upfront" plan (upfront + a professional fee on
// top) and a "Stage" plan (up to 5 numbered stage amounts + a professional
// fee on top) — see src/app/admin/fees/page.tsx's own "Upfront"/"Professional
// Fee"/"First Stage"/"Prof Fee Stage" labels, which this mirrors.
//
// crm_fee's stage columns are generically numbered (firstStage..fifthStage),
// with no "Registration"/"Job Confirmation"/"Work Permit" semantics of their
// own — this resolver assumes the first three map, in order, onto those
// three named milestones. If a given fee record uses stages differently,
// override the mapping or build the WorkPermitFeeStages object by hand
// instead of calling this.

import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import type { WorkPermitFeeStages } from './WorkPermitAgreementTemplate';

interface CrmFeeRow {
  upfront: number | string;
  prof_fee: number | string;
  firstStage: number | string;
  secondStage: number | string;
  thirdStage: number | string;
  prof_fee_stage: number | string;
}

export interface ResolveWorkPermitFeeStagesInput {
  serviceId: number | string | null | undefined;
  countryId: number | string | null | undefined;
  branchId: number | string | null | undefined;
  currencyCode?: string;
  // Force a specific plan when the fee record has both an upfront and a
  // stage amount populated (rare, but crm_fee allows it) — otherwise
  // whichever side of the record has non-zero amounts wins, preferring
  // stage-wise when both are populated.
  preferPlan?: 'upfront' | 'stage_wise';
}

/**
 * Looks up the matching crm_fee row (service + country + branch, active
 * only) and maps it onto Annexure A's fee table shape. Returns null when no
 * fee record exists for that combination — callers should fall back to
 * manual entry in that case rather than showing a table of zeros.
 */
export async function resolveWorkPermitFeeStages(
  input: ResolveWorkPermitFeeStagesInput,
): Promise<WorkPermitFeeStages | null> {
  const { serviceId, countryId, branchId } = input;
  if (!serviceId || !countryId || !branchId) return null;

  const [row] = await sequelize.query<CrmFeeRow>(
    `SELECT upfront, prof_fee, firstStage, secondStage, thirdStage, prof_fee_stage
     FROM crm_fee
     WHERE service = :serviceId AND country = :countryId AND branch = :branchId AND status = 1
     LIMIT 1`,
    {
      replacements: { serviceId, countryId, branchId },
      type: QueryTypes.SELECT,
    },
  );

  if (!row) return null;

  const upfront = Number(row.upfront || 0);
  const profFee = Number(row.prof_fee || 0);
  const firstStage = Number(row.firstStage || 0);
  const secondStage = Number(row.secondStage || 0);
  const thirdStage = Number(row.thirdStage || 0);
  const profFeeStage = Number(row.prof_fee_stage || 0);

  const hasStagePlan = firstStage > 0 || secondStage > 0 || thirdStage > 0 || profFeeStage > 0;
  const hasUpfrontPlan = upfront > 0 || profFee > 0;

  const useStagePlan = input.preferPlan
    ? input.preferPlan === 'stage_wise'
    : hasStagePlan || !hasUpfrontPlan;

  if (useStagePlan) {
    if (!hasStagePlan) return null;
    return {
      planType: 'stage_wise',
      currencyCode: input.currencyCode,
      totalFee: firstStage + secondStage + thirdStage + profFeeStage,
      registrationFee: firstStage,
      jobConfirmationFee: secondStage,
      workPermitFee: thirdStage,
    };
  }

  if (!hasUpfrontPlan) return null;
  return {
    planType: 'upfront',
    currencyCode: input.currencyCode,
    totalFee: upfront + profFee,
    registrationFee: upfront,
  };
}
