// How an appointment row is shown on the dashboards (Today's Appointments). One definition so the counselor and
// the main dashboard can't drift: 12-hour time (the follow-ups list already used it) and a status that reflects
// done / verification / no-show / rescheduled / cancelled instead of "Pending" for every booked appointment.

export interface AppointmentLike {
  appointtime?: string | null;
  booked?: number | string | null;
  done?: number | string | null;
  not_done?: number | string | null;
  meeting_status?: string | null;
  meeting_verified?: number | string | null;
}

const flag = (v: unknown) => Number(v ?? 0) === 1;

/** '14:30:00' -> '02:30 PM'; anything unparseable -> 'No time'. */
export function formatAppointmentTime(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return 'No time';
  const hours = Number(match[1]);
  const minutes = match[2];
  return `${String(hours % 12 || 12).padStart(2, '0')}:${minutes} ${hours >= 12 ? 'PM' : 'AM'}`;
}

export type AppointmentTone = 'green' | 'amber' | 'red' | 'gray' | 'blue';

export function appointmentStatus(a: AppointmentLike): { label: string; tone: AppointmentTone } {
  if (flag(a.done)) {
    if (a.meeting_verified === null || a.meeting_verified === undefined || a.meeting_verified === '') return { label: 'Awaiting verification', tone: 'amber' };
    return flag(a.meeting_verified) ? { label: 'Meeting done', tone: 'green' } : { label: 'Verification rejected', tone: 'red' };
  }
  if (flag(a.not_done)) {
    return String(a.meeting_status || '').toLowerCase() === 'no_show' ? { label: 'No-show', tone: 'red' } : { label: 'Cancelled', tone: 'gray' };
  }
  if (String(a.meeting_status || '').toLowerCase() === 'rescheduled') return { label: 'Rescheduled', tone: 'blue' };
  return flag(a.booked ?? 1) ? { label: 'Scheduled', tone: 'blue' } : { label: 'Pending', tone: 'amber' };
}

export const toneClasses: Record<AppointmentTone, string> = {
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  gray: 'bg-gray-100 text-gray-600',
  blue: 'bg-blue-50 text-blue-700',
};
