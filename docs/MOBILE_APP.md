# Navigator CRM mobile app

The React Native app lives in [`mobile/`](../mobile) (setup and run instructions: [`mobile/README.md`](../mobile/README.md)).
This document covers how it fits the backend, the push-notification pipeline, and how to operate it.

## 1. What was built

**App scope** (core + approvals + HR self-service): sign-in with MFA, role-based dashboards, leads (search, status
filters, detail, remarks, follow-ups, create/edit), lead pool, clients, follow-ups, meetings, outstanding balances,
the approvals inbox (discounts, Accounts payments, compliance), notifications, attendance, leave, payslips, IT
tickets, profile and settings.

**Not in the app** (web-suited or a different audience): client portal, the opportunity wizard, operations case
wizards, reports/finance dashboards, Excel/PDF generation, all admin/config pages, recording a payment (needs a
browser-only proof-of-payment upload).

## 2. Architecture

```
                    ┌─────────────────────────── phone ───────────────────────────┐
  web CRM event ──► │ expo-notifications ◄── FCM (Android) / APNs (iOS)            │
  (discount,        │   builds the notification + action buttons natively          │
   payment,         │        │ tap / button                                        │
   compliance,      │        ▼                                                     │
   assignment)      │  resolveNotificationRoute()  ── role check ──► screen        │
        │           │                                     │                        │
        ▼           │  Approve/Reject/Sign-off ─► ConfirmDecision ─► biometrics ─► API
  notifyUser/       └──────────────────────────────────────────────────────────────┘
  notifyRole/
  notifyCeo
        │  CrmcNotifications.afterCreate (after COMMIT when in a transaction)
        ▼
  sendMobilePush ─► eligible type? ─► recipient's active devices ─► facts (1 query) ─► FCM v1 / APNs HTTP/2
```

Layers in `mobile/src`: `features/*` (screens, feature API modules) → `services/api` (client, RBAC pre-check,
refresh) → `services/{storage,db,push,security}` → `store/*` (Zustand). Navigation renders **one navigator at a
time** from the session (booting / signed out / forced password change / app), so an unauthenticated user has no
routes to deep-link into, and every gated screen is wrapped in `withAccess()` using the single table in
`navigation/routeAccess.ts`.

## 3. Backend changes (all under the existing Next.js app)

### Sessions for a native client — `src/app/api/mobile/*`, `src/lib/mobile*.ts`

The web login returns its JWT only in an httpOnly cookie, and its MFA step is cookie-only, so a native app cannot
use it. The mobile routes are additive twins; the web flow is untouched.

| Route | Purpose |
|---|---|
| `POST /api/mobile/auth/login` | `{username,password}` → `{accessToken, refreshToken, expiresIn, user}` or `{mfaRequired, mfaToken}` |
| `POST /api/mobile/auth/verify-mfa` | `{mfaToken, code}` (body-based twin of the cookie route) |
| `POST /api/mobile/auth/refresh` | Rotates the refresh token; re-checks the employee is still active and rebuilds permissions |
| `POST /api/mobile/auth/logout` | Revokes the session family and deactivates that device's push token |
| `POST/DELETE /api/mobile/devices` | Register / unregister the native push token (upsert by token: a handed-over phone re-binds) |
| `GET /api/mobile/config` | Public startup gate: `minAppVersion`, `latestAppVersion`, `maintenance` |

- **Access token** is the *same JWT shape* `requireAuth()` already verifies (default 1 h), so every existing
  Bearer-capable route accepts it unchanged. `generateToken(user, expiresIn = '24h')` gained the optional TTL.
- **Refresh token**: 48 random bytes, stored only as a sha256 hash, single-use, rotated on every refresh.
  Presenting an already-rotated token later than 10 s revokes the entire session family (theft signal);
  within 10 s it is treated as a retry. Sliding 30-day expiry with a 90-day absolute cap.
- This fixes three gaps the web session has: no revocation, permissions frozen for 24 h, and a deactivated
  employee keeping access until the token expires.
- Errors are `{ error, code? }`.

### Tables — `migrations/20260930_mobile_app.sql` (also self-created by `ensureMobileTables()`)

`crm_mobile_sessions` (hashed refresh tokens, family id, expiry, revocation) and `crm_mobile_devices` (native push
token, platform, APNs environment). Both have an `employee_id` FK with `ON DELETE CASCADE`; if the database refuses
the FK the tables are created without it rather than failing logins.

> **Do not run `npm run db:migrate` to apply this**: it also re-seeds role permissions and would overwrite edits made in
> the roles admin. The first call to any `/api/mobile/*` route creates the tables. On a shared database, apply
> `migrations/20260930_mobile_app.sql` by hand instead, at a time you choose.

### Push sender — `src/lib/mobilePush*.ts`

Direct delivery, no relay service and **no new npm dependency** (uses `jose`, already installed, `fetch`, and Node's
`http2`):

- **Android** → FCM HTTP v1 (`FCM_SERVICE_ACCOUNT_JSON`, OAuth via a signed service-account assertion, token cached).
  Sent as a **data-only** high-priority message: `expo-notifications` builds the notification and its action buttons
  natively from `title`, `message`, `body` (JSON), `channelId`, `categoryId`, `badge`, `tag`, so it works with the app
  killed and needs no JS.
- **iOS** → APNs (`APNS_*`, ES256 provider token, sandbox vs production per device). `aps.alert` + `aps.category`,
  custom data under `body` (what `expo-notifications` surfaces as `notification.data`).
- A token a provider reports dead (`UNREGISTERED`, `410`, `BadDeviceToken`) is deactivated; nothing else deactivates
  a device. A provider that is not configured is skipped, so the in-app bell still works everywhere.
- The hook is `CrmcNotifications.afterCreate`. Inside a transaction (the compliance/finance workflow service) it waits
  for COMMIT, so a rolled-back step never pings a phone. It never throws.
- `MOBILE_PUSH_REDACT=true` sends generic lock-screen text and record ids only (no names, amounts or phone numbers).

### Who gets which push

| Event | Notification type | Recipient | Source of the recipient |
|---|---|---|---|
| New discount request (pending) | `discount_requested` | CEO | existing `notifyRole('director')` in `discount-approvals/route.ts` |
| Payment awaiting Accounts | `payment_submission` | CEO | **new** `notifyCeo()` beside the `accountant` alert in `receipts`, `lead-to-opportunity`, `admin/opportunities/save` |
| Compliance submission | `compliance_submission` | CEO | existing `notifyRole` incl. `director` in `opportunity-compliance-approvals/route.ts` |
| Lead assigned | `lead_assigned` | the new owner | `recordLeadAssignment` / new `notifyLeadAssigned()` |

Fixes that make those true (previously silent):

- **CEO never heard about payments.** The alert went to role type `accountant`, but the seeded Accounts role is type
  `accounts`. `notifyCeo()` selects the CEO by literal role name (`type = director` is shared with Director / Founder /
  Super Admin), never throws, and de-duplicates for 60 s in case a flow hits two endpoints.
- **Auto-approved discounts** used to send the same `discount_requested` type as real requests. They now send
  `discount_auto_approved`, which is not pushed.
- **Three lead-assignment paths never notified the new owner**: Edit Lead reassign (`PUT /api/leads/[id]`), approving a
  reassignment request (`PUT /api/lead-reassignments-working`), and quick edit (`PUT /api/leads-simple/[id]`). The last
  two now go through `recordLeadAssignment`, which also stamps the assigned-since date and writes the audit entry they
  were skipping.
- **`PUT /api/notifications`** updated and deleted by id with no ownership check, so any signed-in user could touch
  another employee's notifications. It is now scoped to `user_id = caller`.

`POST /api/opportunity-payments` also creates a pending payment but has no caller in this repo (every use is a GET),
so no alert was added there.

### Payload contract

`type`, `notificationId`, `category`, `relatedType`, `relatedId`, plus record ids (`leadId`,
`discountApprovalId`, `paymentId`, `complianceApprovalId`) and display facts.

| Push | Display facts (real CRM fields only) |
|---|---|
| Discount | `clientName`, `discountAmount`, `discountPercent`, `currency`, `discountType`, `requestedBy` |
| Payment | `clientName`, `amount`, `currency`, `receiptNumber` |
| Compliance | `clientName`, `submittedBy` |
| Lead | `leadName`, `phone`, `source` |

The CRM has **no client tier, risk score, audit-log score or company profile**, so none are sent; adding them would be
a data-model change. The values in `mobile/src/services/push/types.ts` are the app's half of this contract.

## 4. Push behaviour on the device

- **Registration** after sign-in: Android channels (`default`, `leads`, `approvals`) → role-appropriate action-button
  categories → OS permission → native token → `POST /api/mobile/devices`. Re-registered when the OS rotates the token;
  unregistered on sign-out.
- **Foreground**: a banner (heads-up on Android), sound and badge, only if the signed-in user is meant to see it.
- **Buttons**: `DISCOUNT_APPROVAL` / `ACCOUNT_APPROVAL` → Approve, Reject · `COMPLIANCE_APPROVAL` → Sign-off ·
  `LEAD_ASSIGNED` → Call, View Profile. Categories are role-aware: a counselor never registers the approval sets.
- **Nothing is approved from the lock screen.** Approve / Reject / Sign-off open `ConfirmDecision` for the exact record
  and require biometrics or the device passcode before the request is sent; on iOS the device must also be unlocked to
  press the button. Rejecting a payment or an agreement requires a reason. Call opens the dialer; View Profile opens
  the lead.
- **Routing** is one pure function, `resolveNotificationRoute(data, user, action)`, used for taps, buttons, cold
  start and the in-app feed. It re-checks the role, so a payload for someone else (a shared phone) is ignored.
  A tap while signed out, locked or on a forced password change waits in the push store until it is safe to act.

## 5. Security posture

| Concern | Handling |
|---|---|
| Tokens at rest | Refresh token in Keychain/Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); access token memory-only |
| Cookies | `credentials: 'omit'` on every request (the server reads a cookie *before* a Bearer header) |
| Local data | Encrypted MMKV (AES-256, key in Keychain) and SQLCipher SQLite; both wiped on sign-out; Android backup disabled |
| Sensitive money actions | Biometric/passcode confirm before every approval; server still enforces role, tier and branch |
| RBAC | Route table + `withAccess` guards + a permission pre-check on API calls; server is the authority |
| Session lifecycle | 401 → single-flight refresh → one replay; refresh 401 → sign out; 403 → re-read permissions |
| App lock | Optional biometric lock, re-locks after 30 s in the background, cannot lock out a user with no biometrics |
| Transport | `https` enforced in production builds; TLS pinning is a documented placeholder (off by default) |
| Force update / kill switch | `GET /api/mobile/config` (`MOBILE_MIN_APP_VERSION`, `MOBILE_MAINTENANCE`) |
| Lock-screen privacy | `MOBILE_PUSH_REDACT`; Android channels use private lock-screen visibility; tray cleared on sign-out |

## 6. Backend environment

Added to `.env.example`: `MOBILE_ACCESS_TOKEN_TTL`, `MOBILE_REFRESH_TTL_DAYS`, `MOBILE_SESSION_MAX_DAYS`,
`MOBILE_MIN_APP_VERSION`, `MOBILE_LATEST_APP_VERSION`, `MOBILE_MAINTENANCE`, `MOBILE_MAINTENANCE_MESSAGE`,
`MOBILE_PUSH_ENABLED`, `MOBILE_PUSH_REDACT`, `FCM_SERVICE_ACCOUNT_JSON`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
`APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT`.

On Vercel the sender runs inline in the request (like the existing Pusher push); for the one or two recipients these
events have, that is a single short HTTPS call.

## 7. Behaviour changes visible to web users

- The CEO now also gets in-app bell notifications when a payment is submitted for verification.
- Counselors now get "lead assigned" notifications on the three paths that were silent. Approving a reassignment request and
  the quick-edit path also now stamp the assigned-since date and write the audit entry they were skipping.
- Auto-approved discounts use notification type `discount_auto_approved`.
- `PUT /api/notifications` rejects other users' notification ids.
- Repo plumbing: `mobile/` is excluded from the root `tsconfig` and ESLint, and from Vercel uploads (`.vercelignore`).

## 8. Rollout checklist

1. Decide which database the first mobile login will run against (it creates two tables); apply the SQL by hand on shared/production databases.
2. Deploy the backend with the new env vars. Push works per provider as soon as its credentials are present.
3. Create the Firebase project + Android app, download `google-services.json`, generate the service-account key.
4. Create the APNs key and note key id / team id; enable Push on the App ID.
5. Replace the placeholders (bundle id, EAS project id, API URLs in `eas.json`, brand artwork).
6. `eas build --profile development` and run the end-to-end table in `mobile/README.md` with a CEO and a counselor account.
7. Set `MOBILE_MIN_APP_VERSION` once a build is in users' hands.

## 9. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Login works, no push at all | Provider env missing on the backend, or the device never registered (check `crm_mobile_devices`) |
| Android registers but never receives | `google-services.json` missing at build time, or the notification channel was muted |
| iOS token registers, `BadDeviceToken` | Sandbox/production mismatch: the build's APNs environment must match `environment` on the device row |
| CEO gets discount/compliance but not payments | Payment created via a path that does not call `notifyCeo` (only `receipts`, `lead-to-opportunity`, `admin/opportunities/save` do) |
| Repeated "session revoked" | A refresh response was lost and the old token replayed after the 10 s grace; the user signs in again |
| App shows saved data + banner | Offline (or the server unreachable); cached reads only, changes are disabled |
| "Update required" | `MOBILE_MIN_APP_VERSION` is above the installed version |

## 10. Verification status

| Check | Result |
|---|---|
| Web `tsc --noEmit`, lint (0 errors), full `next build` | Pass; all six `/api/mobile/*` routes compiled |
| Web unit tests (`vitest`) | 67 pass, including real RS256 / ES256 signature verification of the FCM and APNs credentials, request shapes, sandbox routing, dead-token handling and dispatch/redaction |
| Mobile `tsc`, ESLint (0 errors, 0 warnings), `expo-doctor` (21 checks) | Pass |
| Mobile Jest | 112 pass: push router + role policy, action-button contract, RBAC, route access, API client (Bearer, `credentials:'omit'`, refresh, RBAC pre-check, error mapping), session store (single-flight refresh, sign-out wipe, offline boot) |
| Metro/Hermes export (Android) | Pass (1,260 modules) |
| `expo prebuild` (Android) | Pass; production manifest checked: no cleartext, no backup, storage/overlay permissions removed |
| **Not verified** | Anything needing a device or credentials: a real FCM/APNs delivery, the action buttons rendering, the biometric prompts, SQLCipher/MMKV at runtime, iOS prebuild (cannot run on Windows), and the live database path of `/api/mobile/*` (would create tables in the configured database) |
