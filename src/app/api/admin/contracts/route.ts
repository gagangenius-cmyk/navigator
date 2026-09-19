import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { CrmContract, CrmContractAgreement, CrmContractReceipt, CrmEmployee, CrmcOpportunityPayments } from '@/models';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { resolveBranchCurrency, branchCurrencyError } from '@/lib/branchCurrency';
import { resolveBranchExchangeRate } from '@/lib/exchangeRate';
import { formatDocumentNumber, formatReceiptNumber } from '@/lib/documentNumbering';
import { renderAgreementForBranch } from '@/lib/renderAgreementForBranch';
import { createOpportunityForContract } from '@/lib/createOpportunityForContract';
import { logAudit } from '@/lib/auditLog';
import { notifyRole } from '@/lib/notify';

let dbReady = false;
const ensureDB = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

// Creates a new Contract (+ its Agreement, + an optional first Receipt) for
// an existing lead — "add a product to an existing client". Each contract
// is independent: its own branch, service, payment terms, agreement number,
// and receipt trail, regardless of any other contract that lead already has.
//
// Every contract traces back to a "won" Opportunity (see
// createOpportunityForContract), created transparently here when the caller
// didn't already walk one through the sales pipeline — this reuses the
// existing finance/compliance sign-off gate (crm_opportunity_workflow_reviews)
// instead of building a parallel one. Creating a contract does NOT by itself
// make the lead a "Client" — that still requires finance + compliance
// approval on the underlying opportunity, unchanged.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['agreements.create']);
  if (isAuthError(auth)) return auth;
  const user = auth;

  const transaction = await sequelize.transaction();
  try {
    await ensureDB();
    const body = await request.json();

    const leadId = Number(body.leadId);
    const branchId = Number(body.branchId);
    const serviceId = body.serviceId ? Number(body.serviceId) : null;
    const programTypeId = body.programTypeId ? Number(body.programTypeId) : null;
    const countryInterest = body.countryInterest ? Number(body.countryInterest) : null;
    const totalAmount = Number(body.totalAmount);
    const discountAmount = Number(body.discountAmount || 0);
    const contractType = String(body.contractType || 'individual');
    const durationMonths = Number(body.durationMonths || 12);
    const counselorId = body.counselorId ? Number(body.counselorId) : null;

    if (!leadId || !branchId || !totalAmount || totalAmount <= 0) {
      await transaction.rollback();
      return NextResponse.json({ error: 'leadId, branchId, and a positive totalAmount are required.' }, { status: 400 });
    }

    const [leadRow] = await sequelize.query<{
      id: number; fname: string; lname: string; email: string; phone: string; mobile: string; address: string;
    }>(
      'SELECT id, fname, lname, email, phone, mobile, address FROM crm_forum_leads WHERE id = ? LIMIT 1',
      { replacements: [leadId], transaction, type: QueryTypes.SELECT }
    );
    if (!leadRow) {
      await transaction.rollback();
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }
    const clientName = `${leadRow.fname || ''} ${leadRow.lname || ''}`.trim() || `Lead #${leadId}`;

    const branchCurrency = await resolveBranchCurrency(branchId);
    if (!branchCurrency) {
      await transaction.rollback();
      return NextResponse.json({ error: branchCurrencyError(branchId) }, { status: 422 });
    }
    const exchangeRate = await resolveBranchExchangeRate(branchId);

    // A discounted contract must not be created until the discount has been
    // approved at the right tier — same rule and same crm_discount_approvals
    // check already enforced for opportunities in lead-to-opportunity/route.ts.
    if (discountAmount > 0) {
      const approvals = await sequelize.query<{ id: number; status: string }>(
        `SELECT id, status FROM crm_discount_approvals
         WHERE leadId = ? AND discountAmount = ?
         ORDER BY createdAt DESC, id DESC LIMIT 1`,
        { replacements: [leadId, discountAmount], transaction, type: QueryTypes.SELECT }
      );
      if (approvals[0]?.status !== 'approved') {
        await transaction.rollback();
        return NextResponse.json(
          { error: 'Discount approval by a Branch Manager or the CEO is required before this contract can be created.' },
          { status: 403 }
        );
      }
    }

    let serviceName = 'Consulting Service';
    if (serviceId) {
      const [serviceRow] = await sequelize.query<{ name: string }>(
        'SELECT name FROM crm_service WHERE id = ? LIMIT 1',
        { replacements: [serviceId], transaction, type: QueryTypes.SELECT }
      );
      if (serviceRow?.name) serviceName = serviceRow.name;
    }

    const createdBy = Number(user.id);
    const now = new Date();

    const opportunityId = await createOpportunityForContract({
      leadId,
      branchId,
      serviceName,
      totalAmount,
      createdBy,
      currency: branchCurrency.currencyCode,
      transaction,
    });

    const paidAmount = Number(body.initialPayment?.amount || 0);
    const payBalance = Math.max(totalAmount - discountAmount - paidAmount, 0);
    const tempContractNumber = `TEMP-CTR-${Date.now()}`;

    const contract = await CrmContract.create({
      leadId,
      opportunityId,
      contractNumber: tempContractNumber,
      branchId,
      regionId: null,
      countryInterest,
      serviceId,
      programTypeId,
      contractType,
      currency: branchCurrency.currencyCode,
      exchangeRateToAed: exchangeRate.rateToAed,
      payTotal: totalAmount,
      discount: discountAmount,
      paidYet: paidAmount,
      payBalance,
      status: 'active',
      statusDate: now,
      agreeDate: now,
      feeAgreeDate: now,
      counselorId,
      createdBy,
    }, { transaction });
    Object.assign(contract, contract.get({ plain: true }));
    let contractId = Number(contract.id);
    if (!contractId) {
      // Same mysql2/Sequelize caveat documented throughout lead-to-opportunity/route.ts —
      // the returned instance can come back with an unpopulated id even though the row
      // itself inserted correctly. Fall back to the unique placeholder just written.
      const idRows = await sequelize.query<{ id: number }>(
        'SELECT id FROM crm_contracts WHERE contract_number = ? ORDER BY id DESC LIMIT 1',
        { replacements: [tempContractNumber], transaction, type: QueryTypes.SELECT }
      );
      contractId = Number(idRows[0]?.id);
    }

    const contractNumber = formatDocumentNumber({
      prefix: 'CTR',
      branchName: branchCurrency.branchName,
      branchAddress: branchCurrency.branchAddress,
      branchAbbrv: branchCurrency.branchAbbrv,
      product: serviceName,
      sequenceId: contractId,
    });
    await sequelize.query('UPDATE crm_contracts SET contract_number = ? WHERE id = ?', {
      replacements: [contractNumber, contractId],
      transaction,
    });

    let agreementNumber = `TEMP-AG-${Date.now()}`;
    const startDate = body.startDate ? new Date(body.startDate) : now;
    const endDate = new Date(startDate.getTime());
    endDate.setMonth(endDate.getMonth() + durationMonths);

    const agreementContent = renderAgreementForBranch(branchCurrency.branchAbbrv, {
      agreementNumber,
      agreementDate: now.toISOString().slice(0, 10),
      clientName,
      clientEmail: leadRow.email || '',
      clientPhone: leadRow.mobile || leadRow.phone || '',
      clientAddress: leadRow.address || '',
      serviceProgram: serviceName,
      destinationCountry: '',
      totalAmount: totalAmount.toFixed(2),
      initialPayment: paidAmount.toFixed(2),
      secondPayment: payBalance.toFixed(2),
      specialTerms: body.specialTerms || '',
    });

    const agreement = await CrmContractAgreement.create({
      contractId,
      agreementNumber,
      agreementType: 'service_contract',
      agreementTitle: `${serviceName} Agreement`,
      title: `${serviceName} Agreement`,
      duration: String(durationMonths),
      startDate,
      endDate,
      amount: totalAmount,
      totalAmount,
      currency: branchCurrency.currencyCode,
      terms: body.specialTerms || null,
      termsAndConditions: body.specialTerms || null,
      content: agreementContent,
      status: 'generated',
      clientName,
      clientEmail: leadRow.email || null,
      clientPhone: leadRow.mobile || leadRow.phone || null,
      companyName: branchCurrency.branchName,
      companyAddress: branchCurrency.branchAddress,
      createdBy,
    }, { transaction });
    Object.assign(agreement, agreement.get({ plain: true }));
    let agreementId = Number(agreement.id);
    if (!agreementId) {
      const idRows = await sequelize.query<{ id: number }>(
        'SELECT id FROM crm_contract_agreements WHERE agreement_number = ? ORDER BY id DESC LIMIT 1',
        { replacements: [agreementNumber], transaction, type: QueryTypes.SELECT }
      );
      agreementId = Number(idRows[0]?.id);
    }
    agreementNumber = formatDocumentNumber({
      prefix: 'AG',
      branchName: branchCurrency.branchName,
      branchAddress: branchCurrency.branchAddress,
      branchAbbrv: branchCurrency.branchAbbrv,
      product: serviceName,
      sequenceId: agreementId,
    });
    await sequelize.query('UPDATE crm_contract_agreements SET agreement_number = ? WHERE id = ?', {
      replacements: [agreementNumber, agreementId],
      transaction,
    });

    let receipt: CrmContractReceipt | null = null;
    let receiptNumber: string | null = null;
    if (paidAmount > 0) {
      const paymentNumber = `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      const tempReceiptNumber = `TEMP-RC-${Date.now()}`;
      receipt = await CrmContractReceipt.create({
        contractId,
        receiptNumber: tempReceiptNumber,
        paymentNumber,
        paymentStructure: payBalance > 0 ? 'installment' : 'full',
        totalAmount,
        amount: paidAmount,
        paidAmount,
        remainingBalance: payBalance,
        balanceAmount: payBalance,
        currency: branchCurrency.currencyCode,
        exchangeRateToAed: exchangeRate.rateToAed,
        paymentMethod: body.initialPayment?.paymentMethod || 'cash',
        transactionId: body.initialPayment?.transactionId || null,
        paymentDate: now,
        status: 'completed',
        clientName,
        clientEmail: leadRow.email || null,
        clientPhone: leadRow.mobile || leadRow.phone || null,
        serviceName,
        branchName: branchCurrency.branchName,
        discountAmount,
        notes: body.initialPayment?.notes || 'Initial payment recorded when the contract was created.',
        receiptUrl: body.initialPayment?.proofUrl || null,
        createdBy,
      }, { transaction });
      Object.assign(receipt, receipt.get({ plain: true }));
      let receiptId = Number(receipt.id);
      if (!receiptId) {
        const idRows = await sequelize.query<{ id: number }>(
          'SELECT id FROM crm_contract_receipts WHERE receipt_number = ? ORDER BY id DESC LIMIT 1',
          { replacements: [tempReceiptNumber], transaction, type: QueryTypes.SELECT }
        );
        receiptId = Number(idRows[0]?.id);
      }
      receiptNumber = formatReceiptNumber({
        branchName: branchCurrency.branchName,
        branchAddress: branchCurrency.branchAddress,
        branchAbbrv: branchCurrency.branchAbbrv,
        sequenceId: receiptId,
      });
      await sequelize.query('UPDATE crm_contract_receipts SET receipt_number = ? WHERE id = ?', {
        replacements: [receiptNumber, receiptId],
        transaction,
      });

      // Dual-write to the legacy crm_pay_history ledger — recovery-report,
      // finance, and analytics all read from this table — carrying the new
      // contract_id link and a correctly-populated exchange rate (curValue
      // was hardcoded to 0 by every writer historically; this is the first
      // path to actually populate it).
      await sequelize.query(
        `INSERT INTO crm_pay_history
           (leadId, contract_id, amount, counselor_receipt, tabby, date, payMethod, payoption, paycardoption,
            payNextDate, payBalance, tax, payCategory, payment_remarks, remark, status,
            thirdPartyAmt, dmAmt, dmTax, dmRefundAmt, curValue, refNumber,
            created_by, stage, totaltillnow)
         VALUES
           (:leadId, :contractId, :amount, :receiptNumber, 0, :payDate, :payMethod, :payoption, '',
            :payNextDate, :payBalance, 0, 'payment', :remarks, NULL, 1,
            0, :amount, 0, 0, :curValue, :refNumber,
            :createdBy, 'contract_created', :totalPaidSoFar)`,
        {
          replacements: {
            leadId,
            contractId,
            amount: paidAmount,
            receiptNumber,
            payDate: now,
            payMethod: body.initialPayment?.paymentMethod || 'cash',
            payoption: payBalance > 0 ? 'installment' : 'full',
            payNextDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            payBalance,
            remarks: `Initial payment recorded for contract ${contractNumber}`,
            curValue: exchangeRate.rateToAed,
            refNumber: body.initialPayment?.transactionId || paymentNumber,
            createdBy,
            totalPaidSoFar: paidAmount,
          },
          transaction,
        }
      );

      // Also mirror this into crm_opportunity_payments — it's the ONLY table
      // the live Accounts "Payment Verification" queue
      // (/api/admin/opportunity-payments/verify) reads. Without this row, a
      // contract's payment could never be verified through any existing UI,
      // and finance_status on its workflow review would be stuck at
      // 'pending' forever. Reuses the same paymentNumber/receiptNumber as
      // the crm_contract_receipts row above so the two stay traceable.
      await CrmcOpportunityPayments.create({
        opportunityId,
        paymentNumber,
        receiptNumber,
        paymentStructure: payBalance > 0 ? 'installment' : 'full',
        totalAmount,
        amount: paidAmount,
        paidAmount,
        remainingBalance: payBalance,
        balanceAmount: payBalance,
        currency: branchCurrency.currencyCode,
        paymentMethod: body.initialPayment?.paymentMethod || 'cash',
        transactionId: body.initialPayment?.transactionId || null,
        paymentDate: now,
        status: payBalance > 0 ? 'processing' : 'completed',
        dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        description: 'Initial payment for contract',
        clientName,
        clientEmail: leadRow.email || null,
        clientPhone: leadRow.mobile || leadRow.phone || null,
        serviceName,
        branchName: branchCurrency.branchName,
        discountAmount,
        notes: body.initialPayment?.notes || 'Initial payment recorded when the contract was created.',
        receiptUrl: body.initialPayment?.proofUrl || null,
        createdBy,
        createdAt: now,
        updatedAt: now,
      }, { transaction });
    }

    await transaction.commit();

    await logAudit({
      entityType: 'contract',
      entityId: contractId,
      action: 'contract_created',
      summary: `Contract ${contractNumber} created for lead #${leadId} (${serviceName}, ${branchCurrency.currencyCode} ${totalAmount})`,
      actorId: createdBy,
      actorRole: user.roleName || null,
      after: { leadId, branchId, serviceId, totalAmount, discountAmount, paidAmount },
    });

    await notifyRole({
      roleType: 'accountant',
      branchId,
      type: 'contract_created',
      title: 'New contract created',
      message: `Contract ${contractNumber} for ${clientName} is ready for review.`,
      link: `/admin/leads/${leadId}/edit`,
      relatedId: leadId,
      relatedType: 'lead',
    });

    return NextResponse.json({
      success: true,
      contractId,
      contract: { ...contract.get({ plain: true }), contractNumber },
      agreement: { ...agreement.get({ plain: true }), agreementNumber },
      receipt: receipt ? { ...receipt.get({ plain: true }), receiptNumber } : null,
      opportunityId,
    }, { status: 201 });
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating contract:', error);
    return NextResponse.json({ error: 'Failed to create contract' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['agreements.view']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDB();
    const { searchParams } = new URL(request.url);
    const leadId = Number.parseInt(searchParams.get('leadId') || '', 10);
    const page = Number.parseInt(searchParams.get('page') || '1', 10);
    const limit = Number.parseInt(searchParams.get('limit') || '50', 10);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';

    // Per-lead lookup (used by the "Add Contract" wizard's lead detail view) —
    // real, financial contracts from the new multi-contract model. Not to be
    // confused with the global listing below, which serves the separate
    // Contract Management page and reads the legacy signed-PDF document
    // registry (crm_forum_leads_contracts) — a distinct, still-live feature
    // this route continues to serve unchanged.
    if (leadId) {
      const contracts = await CrmContract.findAll({
        where: { leadId, isDeleted: 0 },
        include: [
          { model: CrmContractAgreement, as: 'agreements' },
          { model: CrmContractReceipt, as: 'receipts' },
          { model: CrmEmployee, as: 'counselor', attributes: ['id', 'name'] },
        ],
        order: [['id', 'DESC']],
      });
      return NextResponse.json({ contracts });
    }

    // Global listing for Contract Management page
    const conditions: string[] = ['1=1'];
    const replacements: Record<string, unknown> = { limit, offset: (page - 1) * limit };

    if (search) {
      conditions.push(`(l.fname LIKE :search OR l.lname LIKE :search OR c.contract LIKE :search OR c.id LIKE :searchId)`);
      replacements.search = `%${search}%`;
      replacements.searchId = `%${search}%`;
    }
    if (status) {
      if (status === 'signed') conditions.push(`c.verify = 1`);
      else if (status === 'pending') conditions.push(`c.verify = 0 AND c.contract IS NOT NULL`);
      else if (status === 'draft') conditions.push(`(c.contract IS NULL OR c.contract = '')`);
    }

    const where = conditions.join(' AND ');
    const rows = await sequelize.query<{
      id: number; leadId: number; lead_fname: string; lead_lname: string;
      lead_email: string; lead_phone: string; contract: string; verify: number;
      verify_date: string; remarks: string; payment_status: number;
      branch_name: string; counselor_name: string; created: string;
    }>(
      `SELECT
        c.id, c.leadId,
        COALESCE(l.fname,'') AS lead_fname, COALESCE(l.lname,'') AS lead_lname,
        COALESCE(l.email,'') AS lead_email, COALESCE(l.phone, l.mobile,'') AS lead_phone,
        COALESCE(c.contract,'') AS contract,
        COALESCE(c.verify,0) AS verify,
        c.verify_date, c.remarks,
        COALESCE(c.payment_status,0) AS payment_status,
        COALESCE(b.branch,'N/A') AS branch_name,
        COALESCE(e.name,'Unassigned') AS counselor_name,
        COALESCE(l.created, l.regdate) AS created
      FROM crm_forum_leads_contracts c
      LEFT JOIN crm_forum_leads l ON l.id = c.leadId
      LEFT JOIN crm_branch b ON b.id = l.branch
      LEFT JOIN crm_employee e ON e.id = l.assignTo
      WHERE ${where}
      ORDER BY c.id DESC
      LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    const [countRow] = await sequelize.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM crm_forum_leads_contracts c LEFT JOIN crm_forum_leads l ON l.id = c.leadId WHERE ${where}`,
      { replacements, type: QueryTypes.SELECT }
    );

    const total = Number(countRow?.total || 0);
    const contracts = rows.map(r => ({
      id: r.id,
      leadId: r.leadId,
      leadName: `${r.lead_fname} ${r.lead_lname}`.trim() || `Lead #${r.leadId}`,
      contractNumber: `CNT-${String(r.id).padStart(5, '0')}`,
      type: 'Immigration Agreement',
      status: r.verify === 1 ? 'signed' : r.contract ? 'pending' : 'draft',
      amount: '0',
      currency: 'AED',
      createdDate: r.created || new Date().toISOString(),
      signedDate: r.verify_date || undefined,
      counsilorName: r.counselor_name,
      branchName: r.branch_name,
      fileName: r.contract || '',
      fileSize: r.contract ? 'PDF' : '',
      paymentStatus: r.payment_status,
    }));

    return NextResponse.json({ contracts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error('Error fetching contracts:', error);
    return NextResponse.json({ error: 'Failed to fetch contracts' }, { status: 500 });
  }
}
