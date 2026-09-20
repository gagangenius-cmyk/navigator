-- Opportunity Flow Wizard: the Prospect stage's opportunity name/type/
-- description and the Quotation stage's line items/discount/tax/total/terms
-- previously lived only in React component state until the Payment stage
-- created the real crm_opportunities row - closing the browser before then
-- lost all of it. Moving opportunity creation earlier isn't safe here
-- (POST /api/lead-to-opportunity's duplicate guard only covers a 60-second
-- window, not "this lead already has an opportunity" permanently), so this
-- gives the earlier stages a durable home instead: one JSON snapshot,
-- merged per-stage (read-modify-write) so a later stage's save can never
-- clobber an earlier stage's data.
ALTER TABLE crm_forum_leads
  ADD COLUMN opportunity_draft_data JSON NULL;
