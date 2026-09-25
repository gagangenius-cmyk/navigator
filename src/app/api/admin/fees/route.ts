import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isCeo } from '@/lib/roleChecks';
import { CrmFee } from '@/models/CrmFee';
import type { CrmFeeAttributes } from '@/models/CrmFee';
import { ForeignKeyConstraintError, Op } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { ensureCountryProgramMapping, programTypeIsActive } from '@/lib/countryProgramMapping';

// crm_fee has foreign keys to service, country, branch and currency; a stale form
// (something was deleted in another tab) should read as a fixable input problem.
function feeWriteError(error: unknown, action: 'create' | 'update') {
  if (error instanceof ForeignKeyConstraintError) {
    return NextResponse.json(
      { error: 'The selected program, country, branch or currency no longer exists. Refresh the page and choose again.' },
      { status: 400 }
    );
  }
  console.error(`Error trying to ${action} fee:`, error);
  return NextResponse.json({ error: `Failed to ${action} fee` }, { status: 500 });
}

const PROGRAM_TYPE_REQUIRED = 'Program type is required when a program and a country are selected.';
const PROGRAM_TYPE_UNKNOWN = 'The selected program type does not exist or is inactive.';

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['fees.manage']);
  if (isAuthError(auth)) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const service = searchParams.get('service') || '';
    const country = searchParams.get('country') || '';
    const branch = searchParams.get('branch') || '';

    // Build where clause
    const whereClause: any = {};

    if (search) {
      whereClause[Op.or] = [
        { id: { [Op.like]: `%${search}%` } }
      ];
    }

    if (status !== '') {
      whereClause.status = parseInt(status);
    }

    if (service !== '') {
      whereClause.service = parseInt(service);
    }

    if (country !== '') {
      whereClause.country = parseInt(country);
    }

    if (branch !== '') {
      whereClause.branch = parseInt(branch);
    }

    // Get total count
    const total = await CrmFee.count({ where: whereClause });

    // Get fees with pagination
    const fees = await CrmFee.findAll({
      where: whereClause,
      limit,
      offset: (page - 1) * limit,
      order: [['id', 'DESC']]
    });

    return NextResponse.json({
      data: fees.map(fee => fee.get({ plain: true })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching fees:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fees' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['fees.manage']);
  if (isAuthError(auth)) return auth;
  try {
    // programType isn't a crm_fee column — it only exists to key the
    // crm_countries_type_program mapping below, so a fee can't be added
    // against a country/program pair that has no corresponding mapping row.
    const { programType, ...feeFields } = await request.json();

    // A fee for a program + country always gets its country/type/program mapping. (A fee with no
    // country has nothing to map: the mapping table requires one.)
    const needsMapping = Boolean(feeFields.service && feeFields.country);
    if (needsMapping) {
      if (!programType) return NextResponse.json({ error: PROGRAM_TYPE_REQUIRED }, { status: 400 });
      if (!(await programTypeIsActive(Number(programType)))) {
        return NextResponse.json({ error: PROGRAM_TYPE_UNKNOWN }, { status: 400 });
      }
    }

    // The fee and its mapping commit together or not at all, so a failure can never leave a fee
    // without its relation (or make the user retry into a duplicate fee).
    const newFee = await sequelize.transaction(async (transaction) => {
      const created = await CrmFee.create({ ...feeFields, status: 1 }, { transaction });
      if (needsMapping) {
        await ensureCountryProgramMapping(
          Number(feeFields.country),
          Number(programType),
          Number(feeFields.service),
          Number(auth.id),
          transaction
        );
      }
      return created;
    });

    return NextResponse.json(newFee.get({ plain: true }), { status: 201 });
  } catch (error) {
    return feeWriteError(error, 'create');
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireAuth(request, ['fees.manage']);
  if (isAuthError(auth)) return auth;
  try {
    const { id, programType, ...updateData } = await request.json();

    const fee = await CrmFee.findByPk(id);

    if (!fee) {
      return NextResponse.json(
        { error: 'Fee not found' },
        { status: 404 }
      );
    }

    // programType is optional on update (a status toggle sends only { id, status }); when the form
    // does send it, the fee's country/type/program mapping is ensured just like on create.
    const service = updateData.service ?? fee.service;
    const country = updateData.country ?? fee.country;
    const mapPair = Boolean(service && country && programType);
    if (mapPair && !(await programTypeIsActive(Number(programType)))) {
      return NextResponse.json({ error: PROGRAM_TYPE_UNKNOWN }, { status: 400 });
    }

    await sequelize.transaction(async (transaction) => {
      await fee.update(updateData, { transaction });
      if (mapPair) {
        await ensureCountryProgramMapping(Number(country), Number(programType), Number(service), Number(auth.id), transaction);
      }
    });

    return NextResponse.json(fee.get({ plain: true }));
  } catch (error) {
    return feeWriteError(error, 'update');
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireAuth(request, ['fees.manage']);
  if (isAuthError(auth)) return auth;
  if (!isCeo(auth)) {
    return NextResponse.json({ error: 'Only the CEO can delete records' }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '');

    const fee = await CrmFee.findByPk(id);
    
    if (!fee) {
      return NextResponse.json(
        { error: 'Fee not found' },
        { status: 404 }
      );
    }

    await fee.destroy();

    return NextResponse.json({ message: 'Fee deleted successfully' });
  } catch (error) {
    console.error('Error deleting fee:', error);
    return NextResponse.json(
      { error: 'Failed to delete fee' },
      { status: 500 }
    );
  }
}
