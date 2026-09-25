import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForeignKeyConstraintError, UniqueConstraintError } from 'sequelize';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  create: vi.fn(),
  findByPk: vi.fn(),
}));

vi.mock('@/lib/sequelize', () => ({ sequelize: { query: mocks.query, transaction: mocks.transaction } }));
vi.mock('@/models/CrmFee', () => ({
  CrmFee: { create: mocks.create, findByPk: mocks.findByPk, count: vi.fn(), findAll: vi.fn() },
}));
vi.mock('@/lib/apiAuth', () => ({ requireAuth: () => ({ id: 7 }), isAuthError: () => false }));
vi.mock('@/lib/roleChecks', () => ({ isCeo: () => true }));

import { POST, PUT } from '@/app/api/admin/fees/route';

const TX = { id: 'tx' };

const feeBody = { service: 5, country: 2, programType: 3, branch: 2, currency: 7, upfront: 9900, prof_fee: 1500 };

const request = (method: 'POST' | 'PUT', body: unknown) =>
  new NextRequest('http://localhost/api/admin/fees', { method, body: JSON.stringify(body) });

/** Answers the three queries the mapping code issues. */
function sql(options: { typeActive?: boolean; mappingExists?: boolean; insertError?: Error } = {}) {
  mocks.query.mockImplementation(async (statement: string) => {
    if (statement.includes('FROM crm_program_type')) return options.typeActive === false ? [] : [{ id: 3 }];
    if (statement.includes('SELECT id FROM crm_countries_type_program')) return options.mappingExists ? [{ id: 1 }] : [];
    if (statement.includes('INSERT INTO crm_countries_type_program')) {
      if (options.insertError) throw options.insertError;
      return [1, 1];
    }
    throw new Error(`unexpected SQL: ${statement}`);
  });
}

const insertCalls = () => mocks.query.mock.calls.filter(([statement]) => String(statement).includes('INSERT INTO crm_countries_type_program'));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Mirrors Sequelize: run the callback inside a transaction; if it throws, roll back and rethrow.
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback(TX));
  mocks.create.mockResolvedValue({ get: () => ({ id: 171, ...feeBody, status: 1 }) });
  sql();
});

describe('POST /api/admin/fees - country/type/program relation', () => {
  it('creates the fee and its crm_countries_type_program row in one transaction', async () => {
    const response = await POST(request('POST', feeBody));

    expect(response.status).toBe(201);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    // programType keys the mapping only; it is not a crm_fee column.
    const [fields, options] = mocks.create.mock.calls[0];
    expect(fields).not.toHaveProperty('programType');
    expect(fields).toMatchObject({ service: 5, country: 2, status: 1 });
    expect(options).toEqual({ transaction: TX });

    expect(insertCalls()).toHaveLength(1);
    const [, insertOptions] = insertCalls()[0];
    expect(insertOptions.replacements).toEqual({ countryId: 2, typeId: 3, programId: 5, userId: 7 });
    expect(insertOptions.transaction).toBe(TX);
  });

  it('does not duplicate a mapping that already exists', async () => {
    sql({ mappingExists: true });
    const response = await POST(request('POST', feeBody));

    expect(response.status).toBe(201);
    expect(insertCalls()).toHaveLength(0);
  });

  it('treats a concurrent duplicate (unique key) as success, not an error', async () => {
    sql({ insertError: new UniqueConstraintError({}) });
    const response = await POST(request('POST', feeBody));

    expect(response.status).toBe(201);
  });

  it('rejects a fee with a program and country but no program type, and saves nothing', async () => {
    const withoutType: Partial<typeof feeBody> = { ...feeBody };
    delete withoutType.programType;
    const response = await POST(request('POST', withoutType));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/program type is required/i);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown or inactive program type, and saves nothing', async () => {
    sql({ typeActive: false });
    const response = await POST(request('POST', { ...feeBody, programType: 999 }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/does not exist or is inactive/i);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('needs no mapping (and no program type) when the fee has no country', async () => {
    const response = await POST(request('POST', { service: 5, branch: 2, currency: 7, upfront: 3500 }));

    expect(response.status).toBe(201);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('fails the whole save if the mapping cannot be written, so no fee is left without its relation', async () => {
    sql({ insertError: new Error('connection lost') });
    const response = await POST(request('POST', feeBody));

    expect(response.status).toBe(500);
    // Both writes ran inside the same transaction, which the failure rolls back.
    expect(mocks.create.mock.calls[0][1]).toEqual({ transaction: TX });
    expect(insertCalls()[0][1].transaction).toBe(TX);
  });

  it('explains a foreign-key failure instead of returning a bare 500', async () => {
    mocks.create.mockRejectedValue(new ForeignKeyConstraintError({}));
    const response = await POST(request('POST', feeBody));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/no longer exists/i);
  });
});

describe('PUT /api/admin/fees', () => {
  const existingFee = () => ({ service: 5, country: 2, update: vi.fn(), get: () => ({ id: 171, service: 5, country: 2 }) });

  it('a plain edit (status toggle) does not touch the mapping', async () => {
    const fee = existingFee();
    mocks.findByPk.mockResolvedValue(fee);
    const response = await PUT(request('PUT', { id: 171, status: 0 }));

    expect(response.status).toBe(200);
    expect(fee.update).toHaveBeenCalledWith({ status: 0 }, { transaction: TX });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('ensures the mapping, inside the same transaction, when the form sends a program type', async () => {
    const fee = existingFee();
    mocks.findByPk.mockResolvedValue(fee);
    const response = await PUT(request('PUT', { id: 171, upfront: 10500, programType: 3 }));

    expect(response.status).toBe(200);
    expect(fee.update).toHaveBeenCalledWith({ upfront: 10500 }, { transaction: TX });
    expect(insertCalls()).toHaveLength(1);
    expect(insertCalls()[0][1].replacements).toEqual({ countryId: 2, typeId: 3, programId: 5, userId: 7 });
    expect(insertCalls()[0][1].transaction).toBe(TX);
  });

  it('rejects an unknown program type without updating the fee', async () => {
    sql({ typeActive: false });
    const fee = existingFee();
    mocks.findByPk.mockResolvedValue(fee);
    const response = await PUT(request('PUT', { id: 171, programType: 999 }));

    expect(response.status).toBe(400);
    expect(fee.update).not.toHaveBeenCalled();
  });
});
