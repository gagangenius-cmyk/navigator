import { describe, expect, it } from 'vitest';
import { appointmentStatus, formatAppointmentTime } from '@/lib/appointmentDisplay';

describe('formatAppointmentTime', () => {
  it('formats 24h SQL times as 12h', () => {
    expect(formatAppointmentTime('14:30:00')).toBe('02:30 PM');
    expect(formatAppointmentTime('09:05:00')).toBe('09:05 AM');
    expect(formatAppointmentTime('00:00:00')).toBe('12:00 AM');
    expect(formatAppointmentTime('12:15:00')).toBe('12:15 PM');
  });
  it('handles missing / bad values', () => {
    expect(formatAppointmentTime(null)).toBe('No time');
    expect(formatAppointmentTime('soon')).toBe('No time');
  });
});

describe('appointmentStatus', () => {
  it('distinguishes the lifecycle', () => {
    expect(appointmentStatus({ booked: 1 }).label).toBe('Scheduled');
    expect(appointmentStatus({ booked: 0 }).label).toBe('Pending');
    expect(appointmentStatus({ done: 1, meeting_verified: null }).label).toBe('Awaiting verification');
    expect(appointmentStatus({ done: 1, meeting_verified: 1 }).label).toBe('Meeting done');
    expect(appointmentStatus({ done: 1, meeting_verified: 0 }).label).toBe('Verification rejected');
    expect(appointmentStatus({ not_done: 1 }).label).toBe('Cancelled');
    expect(appointmentStatus({ not_done: 1, meeting_status: 'no_show' }).label).toBe('No-show');
    expect(appointmentStatus({ booked: 1, meeting_status: 'rescheduled' }).label).toBe('Rescheduled');
  });
  it('accepts numbers delivered as strings', () => {
    expect(appointmentStatus({ done: '1', meeting_verified: '1' }).label).toBe('Meeting done');
    expect(appointmentStatus({ done: '1', meeting_verified: '0' }).label).toBe('Verification rejected');
  });
});
