'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';

interface SignupConfig {
  configured: boolean;
  appId: string;
  configId: string;
  graphApiVersion: string;
  missing: string[];
}

interface SignupPhone {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string | null;
  isOnBizApp: boolean | null;
}

interface SignupResponse {
  success: boolean;
  error?: string;
  wabaId?: string;
  phones?: SignupPhone[];
}

type FbLoginResponse = { authResponse?: { code?: string } | null };
type FbSdk = {
  init: (options: Record<string, unknown>) => void;
  login: (callback: (response: FbLoginResponse) => void, options: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const FACEBOOK_ORIGINS = new Set(['https://www.facebook.com', 'https://web.facebook.com']);
const SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';

function loadFacebookSdk(appId: string, version: string): Promise<FbSdk> {
  return new Promise((resolve, reject) => {
    const init = () => {
      if (!window.FB) return reject(new Error('Facebook SDK did not load'));
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB);
    };
    if (window.FB) return init();
    window.fbAsyncInit = init;
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('Could not load the Facebook SDK (blocked by an ad blocker?)'));
    document.body.appendChild(script);
  });
}

export default function WhatsAppConnectCard() {
  const [config, setConfig] = useState<SignupConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SignupResponse | null>(null);

  // Meta delivers the auth code (FB.login callback) and the account ids (a
  // postMessage) separately, in either order - hold both until we have them.
  const codeRef = useRef<string | null>(null);
  const sessionRef = useRef<{ wabaId: string; phoneNumberId: string | null } | null>(null);

  useEffect(() => {
    fetch('/api/admin/meta-leads/whatsapp-signup')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() => setError('Could not load the WhatsApp connection settings'));
  }, []);

  const submit = useCallback(async () => {
    const code = codeRef.current;
    const session = sessionRef.current;
    if (!code || !session) return;
    codeRef.current = null;
    sessionRef.current = null;
    try {
      const res = await fetch('/api/admin/meta-leads/whatsapp-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId }),
      });
      const data: SignupResponse = await res.json();
      if (!res.ok || !data.success) setError(data.error || 'WhatsApp connection failed');
      else setResult(data);
    } catch {
      setError('WhatsApp connection request failed');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!FACEBOOK_ORIGINS.has(event.origin) || typeof event.data !== 'string') return;
      let payload: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string; current_step?: string } };
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (payload.event?.startsWith('FINISH') && payload.data?.waba_id) {
        sessionRef.current = { wabaId: String(payload.data.waba_id), phoneNumberId: payload.data.phone_number_id ? String(payload.data.phone_number_id) : null };
        void submit();
      } else if (payload.event === 'CANCEL') {
        setBusy(false);
        setError(`Signup cancelled${payload.data?.current_step ? ` at step "${payload.data.current_step}"` : ''}`);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [submit]);

  const connect = async () => {
    if (!config?.configured) return;
    setError('');
    setResult(null);
    setBusy(true);
    codeRef.current = null;
    sessionRef.current = null;
    try {
      const fb = await loadFacebookSdk(config.appId, config.graphApiVersion);
      fb.login(
        (response) => {
          const code = response.authResponse?.code;
          if (!code) {
            setBusy(false);
            setError('Meta login was cancelled or did not complete');
            return;
          }
          codeRef.current = code;
          void submit();
        },
        {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          // Connect a number that is still used in the WhatsApp Business app (coexistence).
          extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
        },
      );
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not start WhatsApp signup');
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-600 text-white">
          <MessageCircle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-gray-900">WhatsApp Click-to-WhatsApp leads</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Connect the number you use in the WhatsApp Business app so ad chats also reach the CRM.
            The number stays in the app and keeps working there.
          </p>

          {config && !config.configured && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Not set up yet. Missing server settings: {config.missing.join(', ')}. See docs/WHATSAPP_COEXISTENCE.md.</span>
            </div>
          )}

          {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {result?.success && (
            <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              <div className="flex items-center gap-1.5 font-medium">
                <CheckCircle className="h-4 w-4" /> Connected. WhatsApp account {result.wabaId} now sends its messages to the CRM.
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {(result.phones ?? []).map((p) => (
                  <li key={p.id}>
                    {p.displayPhoneNumber ?? p.id} - {p.status ?? 'unknown status'}
                    {p.isOnBizApp ? ' - still active in the WhatsApp Business app' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={connect}
            disabled={busy || !config?.configured}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy ? 'Waiting for Meta…' : 'Connect WhatsApp Business app number'}
          </button>
        </div>
      </div>
    </div>
  );
}
