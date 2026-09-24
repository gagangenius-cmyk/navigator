import { API_BASE_URL } from '@/constants/config';

// TLS certificate pinning - PLACEHOLDER, disabled until you configure pins.
//
// Pinning makes the app refuse a connection to the API unless the server's public
// key matches one you shipped, defeating a rogue/compromised certificate authority
// or a corporate MITM proxy. It also makes certificate rotation an operational
// event: pin at least TWO keys (current + a backup) or a rotation will lock every
// installed app out until it is updated.
//
// To enable:
//   1. npx expo install react-native-ssl-public-key-pinning   (then rebuild the dev client)
//   2. Get the SPKI hash of your API certificate(s):
//        openssl s_client -connect crm.example.com:443 </dev/null 2>/dev/null \
//          | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der \
//          | openssl dgst -sha256 -binary | openssl enc -base64
//   3. Set EXPO_PUBLIC_SSL_PINS="hashA=,hashB=" in the build profile (eas.json).
//   4. initSslPinning() runs at startup (see App.tsx); nothing else to change.

export interface PinningConfig {
  enabled: boolean;
  hostname: string;
  pins: string[];
}

export function getPinningConfig(rawPins: string | undefined = process.env.EXPO_PUBLIC_SSL_PINS): PinningConfig {
  const pins = (rawPins ?? '')
    .split(',')
    .map((pin) => pin.trim())
    .filter(Boolean);
  let hostname = '';
  try {
    hostname = new URL(API_BASE_URL).hostname;
  } catch {
    // no valid API URL configured - pinning stays off
  }
  return { enabled: pins.length > 0 && hostname.length > 0, hostname, pins };
}

interface PinningModule {
  initializeSslPinning: (config: Record<string, { includeSubdomains?: boolean; publicKeyHashes: string[] }>) => Promise<void>;
}

// Resolved at runtime so the app builds and runs without the optional package.
function loadPinningModule(): PinningModule | null {
  try {
    // Intentionally dynamic: the package is optional and only present when pinning is enabled.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-ssl-public-key-pinning') as PinningModule;
  } catch {
    return null;
  }
}

export async function initSslPinning(config: PinningConfig = getPinningConfig()): Promise<void> {
  if (!config.enabled) return;
  if (config.pins.length < 2) {
    console.warn('SSL pinning: only one pin configured. Add a backup pin before shipping - a certificate rotation would lock every app out.');
  }
  const module = loadPinningModule();
  if (!module) {
    console.warn('SSL pinning is configured but react-native-ssl-public-key-pinning is not installed.');
    return;
  }
  await module.initializeSslPinning({ [config.hostname]: { includeSubdomains: true, publicKeyHashes: config.pins } });
}
