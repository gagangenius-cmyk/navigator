// Client-side mirror of the server's validateLeadSubmission (src/app/api/leads/route.ts):
// the same rules, so the user gets an instant, field-level message instead of a 422.
// The server stays the authority.

const NAME_PATTERN = /^[\p{L}][\p{L}\s.'-]*$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface LeadFormValues {
  fname: string;
  lname: string;
  email: string;
  phone: string;
  service_interest?: string;
  country_interest?: string;
}

export type LeadFormErrors = Partial<Record<keyof LeadFormValues, string>>;

export function validateLeadForm(values: LeadFormValues): LeadFormErrors {
  const errors: LeadFormErrors = {};
  if (!NAME_PATTERN.test(values.fname.trim())) errors.fname = 'Enter a valid first name.';
  if (!NAME_PATTERN.test(values.lname.trim())) errors.lname = 'Enter a valid last name.';
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = 'Enter a valid email address.';
  const digits = values.phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) errors.phone = 'Enter a phone number with 7 to 15 digits.';
  return errors;
}

export const hasErrors = (errors: LeadFormErrors): boolean => Object.keys(errors).length > 0;
