# WhatsApp Business app coexistence -> CRM

Goal: keep the number (+971 55 947 6936) working in the WhatsApp Business app on the
phone **and** receive its messages (Click-to-WhatsApp ad leads) in the CRM.

## Why this is needed
`GET graph.facebook.com/<WHATSAPP_PHONE_NUMBER_ID>?fields=status,is_on_biz_app` shows
`status: DISCONNECTED, is_on_biz_app: true`: the number lives in the Business app and is
not connected to the Cloud API, so Meta sends no webhooks for it. Registering it normally
fails ("already registered to a WhatsApp account"); deleting it from the app is not wanted.
Coexistence connects it to the Cloud API without removing it from the app.

## Steps
1. Prerequisites: number is on the **WhatsApp Business** app (not regular WhatsApp), app
   version >= 2.24.17, business verified in Meta Business Manager.
2. Pick a Meta Tech Provider / BSP that supports coexistence (e.g. 360dialog, WATI,
   Interakt, AiSensy, Gupshup). Meta's Embedded Signup (coexistence option) must be run by
   such a provider - do NOT use the normal registration flow.
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

## How the CRM treats it
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
