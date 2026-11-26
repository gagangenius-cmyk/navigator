// @ts-nocheck
import { assertLeadAccess } from '@/lib/leadAccess';
import { parseCrmDateTime, dubaiToday, dubaiTime, dubaiNow } from '@/lib/dubaiDate';
import { leadPhoneSearch } from '@/lib/phoneSearch';
import { syncLeadFollowup } from '@/lib/leadSchedule';
import { NextRequest, NextResponse } from 'next/server';
import { CrmcFollowUpReminders, CrmcNotifications } from '@/models';
import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { logLeadRemark, addLeadRemark } from '@/lib/leadRemarks';
import { verifyToken } from '@/lib/auth';
import { isCeo, isBranchManagerOrCeo, canViewCompanyWideWork } from '@/lib/roleChecks';

// crm_follow_up_reminders.completion_notes is a lazily-added column (no
// migration framework in this project) — ensured here so a database that
// predates this column self-heals instead of erroring the first time a
// Sequelize model method (POST's duplicate check, PUT's update) touches it.
// GET doesn't need this: it reads via `SELECT r.*`, which only returns
// whatever columns currently exist rather than erroring on a missing one.
let followUpCompletionNotesColumnReady: Promise<void> | null = null;
const ensureFollowUpCompletionNotesColumn = async () => {
  if (!followUpCompletionNotesColumnReady) {
    followUpCompletionNotesColumnReady = sequelize.query(`
      SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_follow_up_reminders' AND COLUMN_NAME = 'completion_notes'
    `).then(async ([rows]: any) => {
      if (Number(rows?.[0]?.cnt || 0) === 0) {
        await sequelize.query(`ALTER TABLE crm_follow_up_reminders ADD COLUMN completion_notes TEXT NULL AFTER completed_at`);
      }
    }).catch((error) => {
      followUpCompletionNotesColumnReady = null;
      throw error;
    });
  }
  await followUpCompletionNotesColumnReady;
};

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const currentUser = token ? verifyToken(token) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Authentication is required to view follow-ups' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const leadId = searchParams.get('leadId');
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.max(1, parseInt(searchParams.get('limit') || '20', 10));

    const conditions: string[] = [];
    const replacements: Record<string, unknown> = {};

    // Visibility: counselors see only their own follow-ups, Branch Manager
    // sees their whole branch, CEO sees everything. Enforced server-side so
    // it can't be bypassed by omitting/changing the employeeId query param.
    if (isCeo(currentUser) || canViewCompanyWideWork(currentUser)) {
      // no restriction (CEO, Director of Sales, Team Leader / Area Manager)
    } else if (isBranchManagerOrCeo(currentUser)) {
      conditions.push('e.branch = :userBranch');
      replacements.userBranch = Number(currentUser.branch || 0);
    } else {
      conditions.push('r.user_id = :currentUserId');
      replacements.currentUserId = Number(currentUser.id);
    }

    if (employeeId) { conditions.push('r.user_id = :employeeId'); replacements.employeeId = Number(employeeId); }
    if (leadId) { conditions.push('r.lead_id = :leadId'); replacements.leadId = Number(leadId); }
    // `status` (the page's tab buttons) is applied further down, AFTER the summary counts are taken, so every tab
    // keeps showing its own count while another tab is open.
    // Same lead filters as the Leads page: the lead's own status and branch.
    const leadStatus = searchParams.get('leadStatus');
    const leadBranch = searchParams.get('branch');
    if (leadStatus === 'Other') {
      conditions.push("l.status NOT IN (SELECT name FROM crm_lead_status WHERE is_enabled = 1) AND l.status <> 'New'");
    } else if (leadStatus) {
      conditions.push('l.status = :leadStatus'); replacements.leadStatus = leadStatus;
    }
    if (leadBranch && Number.isFinite(Number(leadBranch))) { conditions.push('l.branch = :leadBranch'); replacements.leadBranch = Number(leadBranch); }
    if (startDate && endDate) {
      conditions.push('r.reminder_date BETWEEN :startDate AND :endDate');
      replacements.startDate = startDate;
      replacements.endDate = endDate;
    } else if (startDate) {
      conditions.push('r.reminder_date >= :startDate');
      replacements.startDate = startDate;
    } else if (endDate) {
      conditions.push('r.reminder_date <= :endDate');
      replacements.endDate = endDate;
    }

    if (search) {
      const phone = leadPhoneSearch(search);
      conditions.push(`(
        CONCAT_WS(' ', l.fname, l.lname) LIKE :search
        OR e.name LIKE :search
        OR r.message LIKE :search
        OR ${phone.sql}
      )`);
      Object.assign(replacements, phone.replacements, { search: `%${search}%` });
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // Fetched in full (not LIMITed) because the summary cards below count
    // overdue/upcoming/completed/pending across every row matching the
    // current filters, not just the current page — pagination is applied
    // afterward, in JS, to the same result set.
    const reminders = await sequelize.query(`
      SELECT r.*, l.fname, l.lname, l.email, COALESCE(NULLIF(l.mobile, ''), l.phone) AS phone, l.status AS leadStatus, l.priority AS leadPriority,
             e.name AS employeeName, e.email AS employeeEmail, e.branch AS branchId, b.branch AS branchName
      FROM crm_follow_up_reminders r
      LEFT JOIN crm_forum_leads l ON r.lead_id = l.id
      LEFT JOIN crm_employee e ON r.user_id = e.id
      LEFT JOIN crm_branch b ON b.id = e.branch
      ${whereSql}
      ORDER BY r.reminder_date ASC
    `, { replacements, type: QueryTypes.SELECT });

    // A rescheduled reminder is still open/actionable (see the `status`
    // query-param handling above for why) - treated the same as 'pending'
    // for overdue/upcoming/pending counting throughout this summary.
    const isOpen = (r: { status: string }) => r.status === 'pending' || r.status === 'rescheduled';
    // reminder_date is a UAE wall-clock string, so compare it with the UAE wall clock as strings.
    const now = dubaiNow();
    const overdueReminders = (reminders as any[]).filter(r => isOpen(r) && String(r.reminder_date) < now);

    // Get upcoming reminders (next 7 days)
    const nextWeek = dubaiNow(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    const upcomingReminders = (reminders as any[]).filter(r => {
      const date = String(r.reminder_date);
      return isOpen(r) && date >= now && date <= nextWeek;
    });

    // The tab/status filter. A rescheduled reminder still has a real due date and stays open/actionable, so it counts
    // under pending / overdue / upcoming exactly like the summary cards above count it.
    const matchesStatus = (r: { status: string; reminder_date: string }) => {
      if (!status) return true;
      const date = String(r.reminder_date);
      if (status === 'pending') return isOpen(r);
      if (status === 'overdue') return isOpen(r) && date < now;
      if (status === 'upcoming') return isOpen(r) && date >= now && date <= nextWeek;
      return r.status === status;
    };
    const filtered = (reminders as any[]).filter(matchesStatus);

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const pagedReminders = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      reminders: pagedReminders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary: {
        total: reminders.length,
        overdue: overdueReminders.length,
        upcoming: upcomingReminders.length,
        completed: (reminders as any[]).filter(r => r.status === 'completed').length,
        pending: (reminders as any[]).filter(isOpen).length
      }
    });

  } catch (error) {
    console.error('Error fetching follow-up reminders:', error);
    return NextResponse.json(
      { error: 'Failed to fetch follow-up reminders' },
      { status: 500 }
    );
  }
}

// A follow-up saved/updated is an update to the lead: bump its Last Updated stamp so the Leads list shows it.
async function touchLeadUpdated(leadId: number | null | undefined) {
  const id = Number(leadId);
  if (!id) return;
  try {
    await sequelize.query('UPDATE crm_forum_leads SET last_updated = ?, last_updtd_time = ? WHERE id = ?', {
      replacements: [dubaiToday(), dubaiTime(), id],
      type: QueryTypes.UPDATE,
    });
  } catch (error) {
    console.error('Failed to stamp lead last-updated:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const currentUser = token ? verifyToken(token) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Authentication is required to create a follow-up' }, { status: 401 });
    }
    await ensureFollowUpCompletionNotesColumn();

    const body = await request.json();
    const {
      leadId,
      employeeId, 
      userId,
      reminderType, 
      scheduledAt, 
      reminderDate,
      priority, 
      subject, 
      message,
      notes
    } = body;
    const assignedUserId = employeeId || userId;
    const followUpAt = scheduledAt || reminderDate;
    const reminderMessage = message || subject || notes;

    if (!leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
    }
    if (!assignedUserId) {
      return NextResponse.json({ error: 'employeeId or userId is required' }, { status: 400 });
    }
    if (!followUpAt) {
      return NextResponse.json({ error: 'scheduledAt or reminderDate is required' }, { status: 400 });
    }
    if (!reminderMessage) {
      return NextResponse.json({ error: 'subject or message is required' }, { status: 400 });
    }
    const followUpDate = parseCrmDateTime(followUpAt);
    if (Number.isNaN(followUpDate.getTime())) {
      return NextResponse.json({ error: 'scheduledAt/reminderDate is not a valid date' }, { status: 400 });
    }
    // Same lead scope every other lead route applies - a follow-up (and the
    // notification it fires) can't be created against a lead the caller can't see.
    const accessError = await assertLeadAccess(currentUser, parseInt(leadId));
    if (accessError) return accessError;

    const recentDuplicate = await CrmcFollowUpReminders.findOne({
      where: {
        lead_id: parseInt(leadId),
        user_id: parseInt(assignedUserId),
        message: reminderMessage,
        created_at: { [Op.gte]: new Date(Date.now() - 60_000) },
      },
    });
    if (recentDuplicate) {
      return NextResponse.json({ error: 'This follow-up was already created a moment ago.' }, { status: 409 });
    }

    const reminder = await CrmcFollowUpReminders.create({
      lead_id: parseInt(leadId),
      user_id: parseInt(assignedUserId),
      reminder_date: followUpDate,
      message: reminderMessage,
      priority: priority || 'medium',
      status: body.status || 'pending',
      created_at: new Date(),
      updated_at: new Date()
    });

    // Create notification for the reminder
    await CrmcNotifications.create({
      user_id: parseInt(assignedUserId),
      type: 'followup',
      title: `Follow-up Reminder: ${subject || reminderType || 'Lead follow-up'}`,
      message: `You have a follow-up scheduled for ${followUpDate.toLocaleDateString('en-GB', { timeZone: 'UTC' })}`,
      priority: priority || 'medium',
      link: leadId ? `/admin/leads/${parseInt(leadId)}/edit` : null,
      related_id: leadId ? parseInt(leadId) : null,
      related_type: leadId ? 'lead' : null,
      created_at: new Date(),
      updated_at: new Date()
    });

    await touchLeadUpdated(parseInt(leadId));
    await logLeadRemark({
      leadId: parseInt(leadId),
      action: 'followup_added',
      remark: `Follow-up added for ${followUpDate.toLocaleDateString('en-GB', { timeZone: 'UTC' })}: ${reminderMessage}`,
      newValue: followUpDate.toISOString().split('T')[0],
      // The person who actually set the follow-up gets the credit in their report/Today's Activity (a manager
      // scheduling one for a counselor is the actor, not the counselor).
      actorId: Number(currentUser.id) || parseInt(assignedUserId),
      actorRole: currentUser.roleName || currentUser.type,
    });
    // What the counselor typed on the follow-up is also a lead remark. `remark` (sent by the web popup, blank when
    // nothing was typed) wins over `message`, which can be an auto-filled title.
    await addLeadRemark({
      leadId: parseInt(leadId),
      text: body.remark !== undefined ? body.remark : (message || notes),
      actorId: Number(currentUser.id),
      actorRole: currentUser.roleName || currentUser.type,
    });

    return NextResponse.json({
      success: true,
      reminder
    });

  } catch (error) {
    console.error('Error creating follow-up reminder:', error);
    return NextResponse.json(
      { error: 'Failed to create follow-up reminder' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const token = request.cookies.get('auth-token')?.value
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const currentUser = token ? verifyToken(token) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Authentication is required' }, { status: 401 });
    }
    await ensureFollowUpCompletionNotesColumn();

    const body = await request.json();
    const { reminderId, action, completedAt, rescheduledAt, nextNote } = body;
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

    if (!reminderId || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: reminderId, action' },
        { status: 400 }
      );
    }

    // A follow-up can only be completed/rescheduled/cancelled by the
    // counselor it belongs to, or Branch Manager/CEO for their scope.
    const [existing] = await sequelize.query<{ user_id: number; branch: number | null; lead_id: number | null; status: string | null; message: string | null; priority: string | null }>(`
      SELECT r.user_id, r.lead_id, r.status, r.message, r.priority, e.branch FROM crm_follow_up_reminders r
      LEFT JOIN crm_employee e ON e.id = r.user_id
      WHERE r.id = :reminderId LIMIT 1
    `, { replacements: { reminderId: parseInt(reminderId) }, type: QueryTypes.SELECT });

    if (!existing) {
      return NextResponse.json({ error: 'Follow-up reminder not found' }, { status: 404 });
    }

    const isOwn = Number(existing.user_id) === Number(currentUser.id);
    if (!isOwn) {
      if (isCeo(currentUser)) {
        // unrestricted
      } else if (isBranchManagerOrCeo(currentUser) && Number(existing.branch) === Number(currentUser.branch || 0)) {
        // in-branch manager, allowed
      } else {
        return NextResponse.json({ error: 'You do not have permission to update this follow-up' }, { status: 403 });
      }
    }

    // Reschedule = close the previous follow-up with a lead remark about what happened, and open a new one.
    if (action === 'reschedule') {
      if (!notes) {
        return NextResponse.json({ error: 'Add a lead remark about the previous follow-up before rescheduling' }, { status: 400 });
      }
      const nextAt = parseCrmDateTime(rescheduledAt || '');
      if (Number.isNaN(nextAt.getTime())) {
        return NextResponse.json({ error: 'rescheduledAt must be a valid date' }, { status: 400 });
      }
      if (nextAt.toISOString().slice(0, 19).replace('T', ' ') <= dubaiNow()) {
        return NextResponse.json({ error: 'The new follow-up must be in the future (UAE time)' }, { status: 400 });
      }
      if (!['pending', 'rescheduled'].includes(existing.status || 'pending')) {
        return NextResponse.json({ error: 'This follow-up is already closed' }, { status: 409 });
      }

      const reminder = await sequelize.transaction(async (transaction) => {
        const [, closed] = await sequelize.query(
          `UPDATE crm_follow_up_reminders
           SET status = 'completed', completed_at = UTC_TIMESTAMP(), completion_notes = :notes, updated_at = UTC_TIMESTAMP()
           WHERE id = :id AND COALESCE(status, 'pending') IN ('pending', 'rescheduled')`,
          { replacements: { id: parseInt(reminderId), notes }, type: QueryTypes.UPDATE, transaction },
        );
        // A double click: the first request already closed it and opened the new one.
        if (!closed) return null;
        return CrmcFollowUpReminders.create({
          lead_id: Number(existing.lead_id),
          user_id: Number(existing.user_id),
          reminder_date: nextAt,
          message: String(nextNote || '').trim() || existing.message || 'Lead follow-up',
          priority: body.priority || existing.priority || 'medium',
          status: 'pending',
          created_at: new Date(),
          updated_at: new Date(),
        }, { transaction });
      });
      if (!reminder) {
        return NextResponse.json({ error: 'This follow-up is already closed' }, { status: 409 });
      }
      await syncLeadFollowup(existing.lead_id);

      if (existing.lead_id) {
        const actor = { actorId: Number(currentUser.id), actorRole: currentUser.roleName || currentUser.type };
        await touchLeadUpdated(existing.lead_id);
        await logLeadRemark({
          leadId: Number(existing.lead_id),
          action: 'followup_rescheduled',
          remark: `Follow-up rescheduled to ${String(rescheduledAt).replace('T', ' ')}`,
          newValue: String(rescheduledAt).slice(0, 10),
          ...actor,
        });
        await addLeadRemark({ leadId: Number(existing.lead_id), text: notes, ...actor });
        await addLeadRemark({ leadId: Number(existing.lead_id), text: nextNote, ...actor });
      }
      return NextResponse.json({ success: true, reminder });
    }

    let updateData: any = {};

    switch (action) {
      case 'complete':
        updateData = {
          status: 'completed',
          completed_at: completedAt ? new Date(completedAt) : new Date(),
          completion_notes: notes || undefined,
          updated_at: new Date()
        };
        break;
      case 'cancel':
        updateData = {
          status: 'cancelled',
          completion_notes: notes || undefined,
          updated_at: new Date()
        };
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    const reminder = await CrmcFollowUpReminders.update(updateData, {
      where: { id: parseInt(reminderId) }
    });
    await syncLeadFollowup(existing.lead_id);

    // Completing/rescheduling a follow-up is the actual client call - log it so
    // it shows in Today's Activity.
    if (existing.lead_id) {
      await touchLeadUpdated(existing.lead_id);
      await logLeadRemark({
        leadId: Number(existing.lead_id),
        action: action === 'complete' ? 'followup_completed' : 'followup_cancelled',
        remark: action === 'complete' ? 'Follow-up completed' : 'Follow-up cancelled',
        actorId: Number(currentUser.id),
        actorRole: currentUser.roleName || currentUser.type,
      });
      await addLeadRemark({
        leadId: Number(existing.lead_id),
        text: notes,
        actorId: Number(currentUser.id),
        actorRole: currentUser.roleName || currentUser.type,
      });
    }

    return NextResponse.json({
      success: true,
      reminder
    });

  } catch (error) {
    console.error('Error updating follow-up reminder:', error);
    return NextResponse.json(
      { error: 'Failed to update follow-up reminder' },
      { status: 500 }
    );
  }
}
