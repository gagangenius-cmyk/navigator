-- Extra expense accounts requested for the Add Expense "Account (COA)"
-- dropdown. Codes continue the existing group ranges (2xxx Cost of Sales,
-- 3xxx Personnel); rows already present by name are skipped so a manual add
-- via the COA page isn't duplicated.
INSERT INTO crm_coa_accounts (code, name, group_name, nature)
SELECT v.code, v.name, v.group_name, v.nature FROM (
  SELECT '2006' AS code, 'Vendor Payment' AS name, 'Cost of Sales' AS group_name, 'DR' AS nature
  UNION ALL SELECT '2007', 'B2B Commission', 'Cost of Sales', 'DR'
  UNION ALL SELECT '3008', 'Staff Welfare', 'Personnel', 'DR'
  UNION ALL SELECT '3009', 'Staff Commission', 'Personnel', 'DR'
  UNION ALL SELECT '3010', 'Staff Welfare (Party)', 'Personnel', 'DR'
) v
WHERE NOT EXISTS (SELECT 1 FROM crm_coa_accounts c WHERE c.name = v.name)
  AND NOT EXISTS (SELECT 1 FROM crm_coa_accounts c WHERE c.code = v.code);

-- Expense amounts must keep paise/fils (e.g. 125.50), never be truncated.
ALTER TABLE crm_expense
  MODIFY amount DECIMAL(12,2) NOT NULL,
  MODIFY vat DECIMAL(12,2) NOT NULL DEFAULT 0;
