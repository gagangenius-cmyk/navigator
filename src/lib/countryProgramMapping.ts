import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';

// Shared by src/app/api/admin/program-mappings/route.ts (explicit "Map
// Countries" UI on the Programs page) and src/app/api/admin/fees/route.ts
// (implicit — a new fee against a country/program pair should always have a
// corresponding mapping row, even if nobody mapped it by hand first).
export async function countryProgramMappingExists(countryId: number, typeId: number, programId: number): Promise<boolean> {
  const [existing] = await sequelize.query<{ id: number }>(
    `SELECT id FROM crm_countries_type_program WHERE country = :countryId AND type = :typeId AND program = :programId LIMIT 1`,
    { replacements: { countryId, typeId, programId }, type: QueryTypes.SELECT }
  );
  return !!existing;
}

// Inserts the mapping row if it doesn't already exist. Returns true if a new
// row was created, false if the mapping was already there.
export async function ensureCountryProgramMapping(countryId: number, typeId: number, programId: number, userId: number): Promise<boolean> {
  if (await countryProgramMappingExists(countryId, typeId, programId)) {
    return false;
  }

  await sequelize.query(
    `INSERT INTO crm_countries_type_program (country, type, program, created, created_by) VALUES (:countryId, :typeId, :programId, NOW(), :userId)`,
    { replacements: { countryId, typeId, programId, userId }, type: QueryTypes.INSERT }
  );
  return true;
}
