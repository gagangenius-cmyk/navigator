// Shared by the leave forms, approval lists and HRService. Early Leave is a single working day on
// which the employee records the clock time they left.
export const EARLY_LEAVE = 'Early Leave';

export const isEarlyLeaveTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);

// "15:30:00" -> "3:30 PM". Empty string when there is no time (older requests, other leave types).
export function formatEarlyLeaveTime(value: string | null | undefined): string {
  if (!value || !isEarlyLeaveTime(value)) return '';
  const [hours, minutes] = value.split(':');
  const hour = Number(hours);
  return `${hour % 12 || 12}:${minutes} ${hour < 12 ? 'AM' : 'PM'}`;
}
