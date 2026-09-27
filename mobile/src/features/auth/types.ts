/** The signed-in employee, as returned by /api/mobile/auth/* (freshly built on every refresh). */
export interface SessionUser {
  id: number;
  name: string;
  email: string;
  cemail: string;
  role: number;
  branch: number;
  region: number;
  /** Role type slug, e.g. `director`, `team_leader`, `immigration_advisor`. */
  type: string;
  /** Literal role name, e.g. `CEO`. Use this (not `type`) to identify the CEO. */
  roleName: string;
  photo?: string;
  wfh: number;
  permissions: string[];
  mustChangePassword: boolean;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  user: SessionUser;
}

export type LoginResult =
  | { kind: 'success'; bundle: TokenBundle }
  | { kind: 'mfa'; mfaToken: string };
