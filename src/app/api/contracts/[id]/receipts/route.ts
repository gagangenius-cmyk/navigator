import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { resolveBranchExchangeRate } from '@/lib/exchangeRate';
import { formatReceiptNumber } from '@/lib/documentNumbering';
import { logAudit } from '@/lib/auditLog';
import { notifyRole } from '@/lib/notify';
import { CrmcOpportunityPayments } from '@/models';

let dbReady = false;
const ensureDB = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

interface ContractRow {
  id: number; lead_id: number; opportunity_id: number; branch_id: number; pay_total: string; discount: string;
  paid_yet: string; pay_balance: string; currency: string; is_deleted: number;
  branch_name: string; branch_address: string; branch_abbrv: string;
  client_name: string; client_email: string | null; client_phone: string | null; service_name: string | null;
}

// sequelize.query()'s raw return shape for an INSERT varies by how the
// replacements were passed - handles both the [insertId, meta] tuple and a
// nested { insertId } object, mirroring the proven-working helper in
// src/app/api/leads/route.ts and src/lib/assignmentRuleEngine.ts rather than
// assuming one fixed shape.
function extractInsertId(result: unknown): number {
  const values = Array.isArray(result) ? result : [result];
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    if (value && typeof value === 'object') {
      const insertId = (value as { insertId?: unknown }).insertId;
      if (typeof insertId === 'number' && Number.isInteger(insertId) && insertId > 0) return insertId;
      if (typeof insertId === 'string' && Number.isInteger(Number(insertId)) && Number(insertId) > 0) return Number(insertId);
    }
  }
  return 0;
}

// Records a follow-up receipt (an installment or balance top-up) against an
// EXISTING contract. Separate from contract creation (POST /api/admin/contracts)
// because this is where concurrent writes actually matter: two payments
// against the same contract submitted close together must not both read the
// same stale paidYet/payBalance and silently lose one of them — so the
// contract row is locked (SELECT ... FOR UPDATE, the same pattern already
// used for crm_opportunity_workflow_reviews in
// src/app/api/opportunities/[id]/workflow/route.ts) before it's recomputed.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, ['agreements.create']);
  if (isAuthError(auth)) return auth;
  const user = auth;

  const { id } = await context.params;
  const contractId = Number(id);
  if (!contractId) {
    return NextResponse.json({ error: 'Invalid contract id.' }, { status: 400 });
  }

  const transaction = await sequelize.transaction();
  try {
    await ensureDB();
    const body = await request.json();
    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      await transaction.rollback();
      return NextResponse.json({ error: 'A positive amount is required.' }, { status: 400 });
    }

    const rows = await sequelize.query<ContractRow>(
      `SELECT c.id, c.lead_id, c.opportunity_id, c.branch_id, c.pay_total, c.discount, c.paid_yet, c.pay_balance,
              c.currency, c.is_deleted, b.name AS branch_name, b.address AS branch_address, b.abbrv AS branch_abbrv,
              TRIM(CONCAT(l.fname, ' ', COALESCE(l.lname, ''))) AS client_name, l.email AS client_email,
              COALESCE(l.mobile, l.phone) AS client_phone, s.name AS service_name
       FROM crm_contracts c
       JOIN crm_branch b ON b.id = c.branch_id
       JOIN crm_forum_leads l ON l.id = c.lead_id
       LEFT JOIN crm_service s ON s.id = c.service_id
       WHERE c.id = ? FOR UPDATE`,
      { replacements: [contractId], transaction, type: QueryTypes.SELECT }
    );
    const contract = rows[0];
    if (!contract || contract.is_deleted) {
      await transaction.rollback();
      return NextResponse.json({ error: 'Contract not found.' }, { status: 404 });
    }

    const payTotal = Number(contract.pay_total);
    const discount = Number(contract.discount);
    const paidSoFar = Number(contract.paid_yet);
    const newPaidYet = paidSoFar + amount;
    const newPayBalance = Math.max(payTotal - discount - newPaidYet, 0);

    const exchangeRate = await resolveBranchExchangeRate(contract.branch_id);
    const createdBy = Number(user.id);
    const now = new Date();
    const paymentNumber = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const tempReceiptNumber = `TEMP-RC-${Date.now()}`;

    const insertResult = await sequelize.query(
      `INSERT INTO crm_contract_receipts
         (contract_id, receipt_number, payment_number, payment_structure, total_amount, amount,
          paid_amount, remaining_balance, balance_amount, currency, exchange_rate_to_aed,
          payment_method, transaction_id, payment_date, status, notes, receipt_url, created_by,
          created_at, updated_at)
       VALUES
         (:contractId, :receiptNumber, :paymentNumber, 'installment', :totalAmount, :amount,
          :amount, :remainingBalance, :remainingBalance, :currency, :exchangeRate,
          :paymentMethod, :transactionId, :paymentDate, 'completed', :notes, :receiptUrl, :createdBy,
          :now, :now)`,
      {
        replacements: {
          contractId,
          receiptNumber: tempReceiptNumber,
          paymentNumber,
          totalAmount: payTotal,
          amount,
          remainingBalance: newPayBalance,
          currency: contract.currency,
          exchangeRate: exchangeRate.rateToAed,
          paymentMethod: body.paymentMethod || 'cash',
          transactionId: body.transactionId || null,
          paymentDate: body.paymentDate ? new Date(body.paymentDate) : now,
          notes: body.notes || null,
          receiptUrl: body.proofUrl || null,
          createdBy,
          now,
        },
        transaction,
      }
    );
    let receiptId = extractInsertId(insertResult);
    if (!receiptId) {
      const idRows = await sequelize.query<{ id: number }>(
        'SELECT id FROM crm_contract_receipts WHERE receipt_number = ? ORDER BY id DESC LIMIT 1',
        { replacements: [tempReceiptNumber], transaction, type: QueryTypes.SELECT }
      );
      receiptId = Number(idRows[0]?.id);
      if (!receiptId) throw new Error('Failed to determine the new receipt id.');
    }

    const receiptNumber = formatReceiptNumber({
      branchName: contract.branch_name,
      branchAddress: contract.branch_address,
      branchAbbrv: contract.branch_abbrv,
      sequenceId: receiptId,
    });
    await sequelize.query('UPDATE crm_contract_receipts SET receipt_number = ? WHERE id = ?', {
      replacements: [receiptNumber, receiptId],
      transaction,
    });

    await sequelize.query(
      'UPDATE crm_contracts SET paid_yet = ?, pay_balance = ?, updated_at = ? WHERE id = ?',
      { replacements: [newPaidYet, newPayBalance, now, contractId], transaction }
    );

    // Flip the earliest unpaid installment on this contract's payment
    // schedule to paid when this receipt matches it, so the schedule stays
    // in sync with actual receipts rather than needing to be updated by hand.
    await sequelize.query(
      `UPDATE crm_contract_payment_schedules
       SET status = 'paid', paid_date = ?, receipt_number = ?
       WHERE contract_id = ? AND status = 'pending' AND amount <= ?
       ORDER BY installment_number ASC
       LIMIT 1`,
      { replacements: [now, receiptNumber, contractId, amount], transaction }
    );

    await sequelize.query(
      `INSERT INTO crm_pay_history
         (leadId, contract_id, amount, counselor_receipt, tabby, date, payMethod, payoption, paycardoption,
          payNextDate, payBalance, tax, payCategory, payment_remarks, remark, status,
          thirdPartyAmt, dmAmt, dmTax, dmRefundAmt, curValue, refNumber,
          created_by, stage, totaltillnow)
       VALUES
         (:leadId, :contractId, :amount, :receiptNumber, 0, :payDate, :payMethod, 'installment', '',
          :payNextDate, :payBalance, 0, 'payment', :remarks, NULL, 1,
          0, :amount, 0, 0, :curValue, :refNumber,
          :createdBy, 'contract_receipt', :totalPaidSoFar)`,
      {
        replacements: {
          leadId: contract.lead_id,
          contractId,
          amount,
          receiptNumber,
          payDate: now,
          payMethod: body.paymentMethod || 'cash',
          payNextDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
          payBalance: newPayBalance,
          remarks: body.notes || `Receipt ${receiptNumber} recorded against contract #${contractId}`,
          curValue: exchangeRate.rateToAed,
          refNumber: body.transactionId || paymentNumber,
          createdBy,
          totalPaidSoFar: newPaidYet,
        },
        transaction,
      }
    );

    // Also mirror this into crm_opportunity_payments — it's the ONLY table
    // the live Accounts "Payment Verification" queue
    // (/api/admin/opportunity-payments/verify) reads, so a contract's receipt
    // needs a row here to ever be verifiable through any existing UI.
    await CrmcOpportunityPayments.create({
      opportunityId: contract.opportunity_id,
      paymentNumber,
      receiptNumber,
      paymentStructure: newPayBalance > 0 ? 'installment' : 'full',
      totalAmount: payTotal,
      amount,
      paidAmount: amount,
      remainingBalance: newPayBalance,
      balanceAmount: newPayBalance,
      currency: contract.currency,
      paymentMethod: body.paymentMethod || 'cash',
      transactionId: body.transactionId || null,
      paymentDate: body.paymentDate ? new Date(body.paymentDate) : now,
      status: newPayBalance > 0 ? 'processing' : 'completed',
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      description: `Receipt ${receiptNumber} recorded against contract #${contractId}`,
      clientName: contract.client_name,
      clientEmail: contract.client_email,
      clientPhone: contract.client_phone,
      serviceName: contract.service_name,
      branchName: contract.branch_name,
      notes: body.notes || null,
      receiptUrl: body.proofUrl || null,
      createdBy,
      createdAt: now,
      updatedAt: now,
    }, { transaction });

    await transaction.commit();

    await logAudit({
      entityType: 'contract',
      entityId: contractId,
      action: 'contract_receipt_recorded',
      summary: `Receipt ${receiptNumber} (${contract.currency} ${amount}) recorded against contract #${contractId}`,
      actorId: createdBy,
      actorRole: user.roleName || null,
      before: { paidYet: paidSoFar, payBalance: Number(contract.pay_balance) },
      after: { paidYet: newPaidYet, payBalance: newPayBalance },
    });

    await notifyRole({
      roleType: 'accountant',
      branchId: contract.branch_id,
      type: 'contract_receipt_recorded',
      title: 'Payment recorded on a contract',
      message: `Receipt ${receiptNumber} for ${contract.currency} ${amount} is awaiting accounts verification.`,
      relatedId: contractId,
      relatedType: 'contract',
    });

    return NextResponse.json({
      success: true,
      receiptId,
      receiptNumber,
      paidYet: newPaidYet,
      payBalance: newPayBalance,
    }, { status: 201 });
  } catch (error) {
    await transaction.rollback();
    console.error('Error recording contract receipt:', error);
    return NextResponse.json({ error: 'Failed to record receipt' }, { status: 500 });
  }
}
