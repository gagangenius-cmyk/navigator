// Read-only audit: compares every Sequelize model's declared columns with the
// live database schema (DATABASE_URL). Reports
//   - tables a model maps to that don't exist,
//   - model columns missing from the table (these make every query on that
//     model fail with "Unknown column"),
//   - table columns the model doesn't declare (harmless, informational).
// Run: npx tsx scripts/audit-model-columns.ts
import { QueryTypes } from 'sequelize';
import { sequelize } from '../src/lib/sequelize';
import '../src/models';

(async () => {
  const dbName = (await sequelize.query<{ db: string }>('SELECT DATABASE() AS db', { type: QueryTypes.SELECT }))[0].db;
  const rows = await sequelize.query<{ t: string; c: string }>(
    'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = :db',
    { replacements: { db: dbName }, type: QueryTypes.SELECT },
  );
  const dbCols = new Map<string, Set<string>>();
  for (const { t, c } of rows) {
    const key = t.toLowerCase();
    if (!dbCols.has(key)) dbCols.set(key, new Set());
    dbCols.get(key)!.add(c.toLowerCase());
  }

  const missingTables: string[] = [];
  const missingCols: Array<{ model: string; table: string; cols: string[] }> = [];
  const extraCols: Array<{ model: string; table: string; cols: string[] }> = [];
  const seen = new Set<string>();

  for (const model of Object.values(sequelize.models)) {
    const table = String(model.getTableName()).replace(/`/g, '');
    if (seen.has(`${model.name}:${table}`)) continue;
    seen.add(`${model.name}:${table}`);
    const actual = dbCols.get(table.toLowerCase());
    if (!actual) { missingTables.push(`${model.name} -> ${table}`); continue; }
    const declared = Object.values(model.rawAttributes).map((a: any) => String(a.field || a.fieldName));
    const missing = declared.filter((c) => !actual.has(c.toLowerCase()));
    if (missing.length) missingCols.push({ model: model.name, table, cols: missing });
    const declaredLower = new Set(declared.map((c) => c.toLowerCase()));
    const extra = [...actual].filter((c) => !declaredLower.has(c));
    if (extra.length) extraCols.push({ model: model.name, table, cols: extra });
  }

  console.log(`Database: ${dbName} | models checked: ${seen.size}`);
  console.log(`\nMODEL TABLE MISSING IN DB (${missingTables.length}):`);
  missingTables.forEach((m) => console.log('  ' + m));
  console.log(`\nMODEL COLUMNS MISSING IN DB (${missingCols.length} models):`);
  missingCols.forEach((m) => console.log(`  ${m.model} [${m.table}]: ${m.cols.join(', ')}`));
  console.log(`\nDB COLUMNS NOT IN MODEL (${extraCols.length} models, informational):`);
  extraCols.forEach((m) => console.log(`  ${m.model} [${m.table}]: ${m.cols.join(', ')}`));
  await sequelize.close();
})().catch((e) => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
