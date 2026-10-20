import { describe, it, expect } from 'vitest';
import { suggestMappingsForForm } from '@/lib/meta/auto-map';
import { buildCrmPayload } from '@/lib/meta/mapping-engine';
import type { MetaLeadParsed } from '@/lib/meta/types';

describe('suggestMappingsForForm', () => {
  it('maps custom question labels to CRM fields, destination before residence', () => {
    const out = suggestMappingsForForm([
      { key: 'full_name', type: 'FULL_NAME' },
      { key: 'which_country_do_you_want_to_move_to?', label: 'Which country do you want to move to?', type: 'CUSTOM' },
      { key: 'what_is_your_age_range?', label: 'What is your age range?', type: 'CUSTOM' },
      { key: 'highest_education', label: 'Highest education', type: 'CUSTOM' },
      { key: 'country_of_residence', label: 'Country of residence', type: 'CUSTOM' },
      { key: 'which_visa_are_you_interested_in?', label: 'Which visa are you interested in?', type: 'CUSTOM' },
      { key: 'favourite_colour', label: 'Favourite colour', type: 'CUSTOM' },
    ]);
    const byCrm = Object.fromEntries(out.map(m => [m.crmFieldKey, m.metaFieldKey]));
    expect(byCrm.DestinationCountry).toBe('which_country_do_you_want_to_move_to?');
    expect(byCrm.AgeRange).toBe('what_is_your_age_range?');
    expect(byCrm.Education).toBe('highest_education');
    expect(byCrm.ResidentCountry).toBe('country_of_residence');
    expect(byCrm.ImmigrationType).toBe('which_visa_are_you_interested_in?');
    expect(out.find(m => m.metaFieldKey === 'favourite_colour')).toBeUndefined();
  });

  it('lets only one question claim a CRM field', () => {
    const out = suggestMappingsForForm([
      { key: 'age', label: 'Age', type: 'CUSTOM' },
      { key: 'age_group', label: 'Age group', type: 'CUSTOM' },
    ]);
    expect(out.filter(m => m.crmFieldKey === 'AgeRange')).toHaveLength(1);
  });
});

describe('buildCrmPayload extras', () => {
  const lead = {
    metaLeadId: '1', fullName: 'A B', email: 'a@b.c', phone: '+971500000000',
    pageId: 'p', formId: 'f', formName: 'Form X', campaignId: 'c', campaignName: 'Camp Y',
    adsetId: null, adsetName: null, adId: null, adName: null, metaCreatedTime: null,
    rawLeadData: { id: '1', created_time: '', field_data: [] },
    fields: { full_name: 'A B', email: 'a@b.c', favourite_colour: 'blue' },
  } as MetaLeadParsed;

  it('carries unmapped answers and campaign/form names through', () => {
    const p = buildCrmPayload(lead, [], null);
    expect(p.AdditionalInfo).toBe('favourite colour: blue');
    expect(p.CampaignName).toBe('Camp Y');
    expect(p.FormName).toBe('Form X');
  });
});
