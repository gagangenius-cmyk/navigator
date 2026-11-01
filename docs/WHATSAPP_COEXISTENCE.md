# WhatsApp Business app coexistence -> CRM

Goal: keep the number (+971 55 947 6936) working in the WhatsApp Business app on the
phone **and** receive its messages (Click-to-WhatsApp ad leads) in the CRM.

## Why this is needed
`GET graph.facebook.com/<WHATSAPP_PHONE_NUMBER_ID>?fields=status,is_on_biz_app` shows
`status: DISCONNECTED, is_on_biz_app: true`: the number lives in the Business app and is
not connected to the Cloud API, so Meta sends no webhooks for it. Registering it normally
fails ("already registered to a WhatsApp account"); deleting it from the app is not wanted.
Coexistence connects it to the Cloud API without removing it from the app.

## Route A - connect it yourself from the CRM (no provider, no fees)
The CRM has a **Connect WhatsApp Business app number** button on **Admin -> Meta Lead Ads**
(`/admin/meta-leads`). It runs Meta's Embedded Signup with the coexistence feature type
(`whatsapp_business_app_onboarding`) and then subscribes the CRM's Meta app to your WhatsApp
account so the number's messages (with the Click-to-WhatsApp `referral` data) reach
`/api/webhooks/whatsapp`. The number stays in the WhatsApp Business app.

One-time Meta setup (cannot be done from code):
1. Business verification: Business Settings -> Security Center -> start verification.
2. Meta app (`META_APP_ID`): add the **Facebook Login for Business** product, then create an
   **Embedded Signup configuration** (WhatsApp Embedded Signup, with *WhatsApp Business app
   onboarding / coexistence* enabled). Copy its **Configuration ID**.
3. App settings -> Facebook Login -> add `https://navigatorcrm.online` to *Allowed domains for
   the JavaScript SDK* and enable *Login with the JavaScript SDK*.
4. The person who clicks the button needs a role on the Meta app (Admin/Developer/Tester) and
   full control of the WhatsApp Business account. While the app has standard access this may be
   enough for your own business; if Meta insists on advanced access, submit
   `whatsapp_business_management` and `whatsapp_business_messaging` for app review.
5. Vercel env: `META_EMBEDDED_SIGNUP_CONFIG_ID=<configuration id>` (`META_APP_ID` and
   `META_APP_SECRET` are already used by the other Meta features). Redeploy.
6. Phone: WhatsApp **Business** app >= 2.24.17; keep it open on a stable connection during the
   history sync (up to 24 hours).
7. Open `/admin/meta-leads`, click the button, log in, pick the WhatsApp Business account, enter
   the number, confirm the code and the prompt inside the app. The card then lists the number
   with `CONNECTED` and "still active in the WhatsApp Business app".
8. Point the ad's WhatsApp destination at this number and test with a phone that is not in the CRM.

Nothing is stored: the short-lived token Meta returns is used once to subscribe the account and
is never saved or logged (the audit entry `meta_whatsapp / embedded_signup` only records that it
happened). Requires the `marketing.manage` permission.

## Route B - through a provider (BSP)
Use this if Route A is blocked by Meta review. The provider connects the number for you and
forwards messages to the CRM, authenticated with `WHATSAPP_PROVIDER_WEBHOOK_SECRET` (below).
It is paid (e.g. 360dialog ~EUR 49/number/month) plus Meta's per-message fees.

### Provider steps
1. Prerequisites: number is on the **WhatsApp Business** app (not regular WhatsApp), app
   version >= 2.24.17, business verified in Meta Business Manager.
2. Pick a Meta Tech Provider / BSP that supports coexistence (e.g. 360dialog, WATI,
   Interakt, AiSensy, Gupshup). Do NOT use the normal registration flow.
3. In the provider's onboarding choose "connect existing WhatsApp Business app number",
   enter the number, enter the code, confirm in the app, optionally share chat history.
4. Set a long random value in Vercel: `WHATSAPP_PROVIDER_WEBHOOK_SECRET` (>= 16 chars),
   redeploy.
5. In the provider's dashboard set the webhook URL to
   `https://navigatorcrm.online/api/webhooks/whatsapp` and add a custom header
   `X-Webhook-Secret: <that secret>` (or `Authorization: Bearer <secret>`).
   The provider must forward Meta's native payload (`object: whatsapp_business_account`,
   including the `referral` block of Click-to-WhatsApp ads). Providers that re-shape the
   payload need an adapter - send a sample to be added.
6. Point the ad's WhatsApp destination at this number and publish.

## How the CRM treats incoming messages (both routes)
- Auth: a request is accepted if it has a valid Meta `X-Hub-Signature-256` **or** a valid
  provider secret. With `WHATSAPP_PROVIDER_WEBHOOK_SECRET` unset the secret path is off.
- Coexistence extras (`smb_message_echoes`, `history`, `smb_app_state_sync`) are ignored:
  only customer messages (`value.messages`) and delivery statuses are processed.
- Ad leads: a first message with a `referral` block creates the lead (source "WhatsApp Ads"),
  idempotent per WhatsApp message id; failures are retried by the 5-minute cron.

## Verify
Send a first message to the ad from a phone not in the CRM. A lead with source
"WhatsApp Ads" should appear within a minute; `crm_meta_ctwa_leads` records the referral.
Also fix on the WABA: payment method (error 141006) and time zone (141007) - they block
business-initiated sends (broadcasts), not inbound leads.
