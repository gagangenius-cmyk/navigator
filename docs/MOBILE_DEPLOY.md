# Deploying the mobile backend and shipping the APK

Companion to [`MOBILE_APP.md`](MOBILE_APP.md). The work is committed on
`feature/enterprise-crm-mobile-app` (two commits on top of `master`): the backend (`005634d`) and the app (`dce089c`).
Nothing has been pushed or deployed.

## 1. Before you deploy

| Check | Command / where | Expected |
|---|---|---|
| What is changing | `git diff --stat master...feature/enterprise-crm-mobile-app -- src migrations` | 30-odd backend files, no schema change to existing tables |
| Web behaviour changes | [`MOBILE_APP.md` §7](MOBILE_APP.md#7-behaviour-changes-visible-to-web-users) | CEO payment alert, lead-assignment alerts on 3 paths, `PUT /api/notifications` ownership scoping |
| Backend still builds | `npx tsc --noEmit && npx vitest run` (already green: 67 tests) | pass |

**Database.** The mobile routes create two tables on first use (`crm_mobile_sessions`, `crm_mobile_devices`), in whatever
`DATABASE_URL` the deployment uses. To control *when* that happens, apply the SQL yourself first:

```bash
mysql -h <host> -u <user> -p <database> < migrations/20260930_mobile_app.sql
```

Do **not** use `npm run db:migrate`: it also re-seeds role permissions and would overwrite edits made in the roles admin.

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)

Nothing new is *required*: mobile sessions reuse the existing `JWT_SECRET` and `DATABASE_URL`. Add these as needed
(names and meanings are in `.env.example`); a Vercel env change only takes effect on the **next deployment**.

| Variable | Needed for |
|---|---|
| `FCM_SERVICE_ACCOUNT_JSON` | Android push (Firebase service-account key, raw JSON or base64) |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_ENVIRONMENT` | iOS push |
| `MOBILE_PUSH_ENABLED=false` | Switch push off without a code change |
| `MOBILE_PUSH_REDACT=true` | Generic lock-screen text and record ids only |
| `MOBILE_MIN_APP_VERSION`, `MOBILE_LATEST_APP_VERSION`, `MOBILE_MAINTENANCE(_MESSAGE)` | Force-update / maintenance gate |
| `MOBILE_ACCESS_TOKEN_TTL`, `MOBILE_REFRESH_TTL_DAYS`, `MOBILE_SESSION_MAX_DAYS` | Session lengths (defaults 1 h / 30 d / 90 d) |

## 3. Deploy

Recommended order, so production is only touched once the mobile flow is proven on a preview:

1. `git push -u origin feature/enterprise-crm-mobile-app` — Vercel builds a preview if the project builds branches.
2. **Deployment Protection.** Preview URLs are commonly behind *Vercel Authentication*. The app has no browser session, so it
   would get a login page (HTML) instead of JSON. Either turn protection off for that deployment, or test against a URL that
   is not protected. Symptom in the app: "Request failed" / an HTML snippet as the error message.
3. Smoke-test the preview (replace host and credentials):
   ```bash
   H=https://<preview-host>
   curl -s $H/api/mobile/config                                   # {"minAppVersion":"1.0.0",...}
   curl -s -X POST $H/api/mobile/auth/login -H 'Content-Type: application/json' \
        -d '{"username":"<user>","password":"<password>"}'         # accessToken + refreshToken (or mfaRequired)
   curl -s $H/api/notifications -H "Authorization: Bearer <accessToken>"   # existing web API accepts the mobile token
   curl -s -X POST $H/api/mobile/auth/refresh -H 'Content-Type: application/json' \
        -d '{"refreshToken":"<refreshToken>"}'                     # new pair; replaying the OLD token >10 s later -> 401 session_revoked
   ```
4. Install the APK, open **Server** on the login screen, enter the preview URL, sign in, and run the event table in
   [`mobile/README.md`](../mobile/README.md#4-push-notifications-needs-your-credentials).
5. When satisfied, merge to `master` → production deploy.

## 4. Rollback

- **Stop pushes only:** set `MOBILE_PUSH_ENABLED=false` and redeploy. The in-app bell keeps working.
- **Stop the app connecting:** `MOBILE_MAINTENANCE=true` (the app shows a maintenance screen) and redeploy.
- **Revert the code:** revert the merge. The two new tables are unused by the web app and can stay.
- The web login and cookie flow are untouched by this change, so web users are not affected by a mobile-only problem.

## 5. The APK

`mobile/eas.json` has `development`, `preview` and `production` profiles for EAS cloud builds. A local build on Windows
(what produced the delivered APK) is described in [`mobile/README.md`](../mobile/README.md#8-building-an-apk-locally-on-windows).

Internal builds (`development`, `preview`) show a **Server** setting on the login screen, so one APK can be pointed at
local, preview or production without a rebuild. Production builds ignore any stored override and require `https`.
The APK is signed with the debug keystore: fine for internal testing, **not** for the Play Store (that needs your own
upload keystore, which EAS can manage).
