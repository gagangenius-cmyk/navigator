import { QueryTypes, UniqueConstraintError, type Transaction } from 'sequelize';
import { sequelize } from '@/lib/sequelize';

// Shared by src/app/api/admin/program-mappings/route.ts (explicit "Map
// Countries" UI on the Programs page) and src/app/api/admin/fees/route.ts
// (implicit — a new fee against a country/program pair should always have a
// corresponding mapping row, even if nobody mapped it by hand first).
//
// crm_countries_type_program has a UNIQUE key on (country, type, program)
// (uq_country_type_program), so the pair can only ever be mapped once.
export async function countryProgramMappingExists(
  countryId: number,
  typeId: number,
  programId: number,
  transaction?: Transaction
): Promise<boolean> {
  const [existing] = await sequelize.query<{ id: number }>(
    `SELECT id FROM crm_countries_type_program WHERE country = :countryId AND type = :typeId AND program = :programId LIMIT 1`,
    { replacements: { countryId, typeId, programId }, type: QueryTypes.SELECT, transaction }
  );
  return !!existing;
}

// True when `typeId` is an active row of crm_program_type. The mapping table
// has no foreign key on `type`, so without this a bad id would quietly create
// a mapping that points at nothing.
export async function programTypeIsActive(typeId: number, transaction?: Transaction): Promise<boolean> {
  if (!Number.isInteger(typeId) || typeId <= 0) return false;
  const [row] = await sequelize.query<{ id: number }>(
    `SELECT id FROM crm_program_type WHERE id = :typeId AND status = 1 LIMIT 1`,
    { replacements: { typeId }, type: QueryTypes.SELECT, transaction }
  );
  return !!row;
}

// Inserts the mapping row if it doesn't already exist. Returns true if a new
// row was created, false if the mapping was already there.
//
// Pass the caller's transaction to make the insert part of it (the fees API
// does, so a fee and its mapping are saved together or not at all).
export async function ensureCountryProgramMapping(
  countryId: number,
  typeId: number,
  programId: number,
  userId: number,
  transaction?: Transaction
): Promise<boolean> {
  if (await countryProgramMappingExists(countryId, typeId, programId, transaction)) {
    return false;
  }

  try {
    await sequelize.query(
      `INSERT INTO crm_countries_type_program (country, type, program, created, created_by) VALUES (:countryId, :typeId, :programId, NOW(), :userId)`,
      { replacements: { countryId, typeId, programId, userId }, type: QueryTypes.INSERT, transaction }
    );
  } catch (error) {
    // Another request mapped the same pair between our check and the insert;
    // the unique key stopped the duplicate, which is the outcome we wanted.
    if (error instanceof UniqueConstraintError) return false;
    throw error;
  }
  return true;
}
