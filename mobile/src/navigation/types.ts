import type { NavigatorScreenParams } from '@react-navigation/native';
import type { ApprovalKind, ApprovalSegment } from '@/services/push/router';

export type AuthStackParamList = {
  Login: undefined;
  Mfa: undefined;
};

export type TabParamList = {
  Home: undefined;
  Leads: undefined;
  Approvals: { segment?: ApprovalSegment; highlightId?: string } | undefined;
  Notifications: undefined;
  More: undefined;
};

export type AppStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  LeadDetail: { leadId: number };
  LeadForm: { leadId?: number } | undefined;
  FollowUps: undefined;
  Appointments: undefined;
  LeadPool: undefined;
  Clients: undefined;
  Balances: undefined;
  PaymentSubmission: { leadId: number };
  ConfirmDecision: { approval: ApprovalKind; decision: 'approve' | 'reject'; recordId: string; leadId?: number };
  Attendance: undefined;
  TeamAttendance: undefined;
  Leave: undefined;
  Payslips: undefined;
  ItTickets: undefined;
  Profile: undefined;
  ChangePassword: undefined;
  Settings: undefined;
};

export type ForcedPasswordParamList = {
  ForcedPassword: undefined;
};

export type RouteName = keyof AppStackParamList | keyof TabParamList;
