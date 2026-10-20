import { sequelize } from '@/lib/sequelize';

// crm_forum_leads.meta_campaign_name holds the Meta (Facebook/Instagram) ad
// campaign name a lead came from, stamped at intake by webToLeadsIngest.ts and
// shown on the Leads page. Lazily added like ensureClientActualNameColumn.ts,
// and deliberately NOT declared on the CrmcForumLeads model so a database that
// hasn't been touched yet can't break every model query.
let metaCampaignNameColumnReady: Promise<void> | null = null;
export const ensureMetaCampaignNameColumn = async () => {
  if (!metaCampaignNameColumnReady) {
    metaCampaignNameColumnReady = sequelize.query(`
      SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_forum_leads' AND COLUMN_NAME = 'meta_campaign_name'
    `).then(async ([rows]: any) => {
      if (Number(rows?.[0]?.cnt || 0) === 0) {
        await sequelize.query(`ALTER TABLE crm_forum_leads ADD COLUMN meta_campaign_name VARCHAR(255) NULL`);
      }
    }).catch((error) => {
      metaCampaignNameColumnReady = null;
      throw error;
    });
  }
  await metaCampaignNameColumnReady;
};
