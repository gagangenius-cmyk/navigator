export type ServerUrlResult = { ok: true; url: string } | { ok: false; error: string };

// scheme://host[:port][/path] - no credentials, query or fragment.
const PATTERN = /^(https?):\/\/([^\s/?#@]+)(\/[^\s?#]*)?(?:[?#].*)?$/i;

/**
 * Validates and normalises a backend URL typed by a person (the "Server" setting on the
 * login screen of non-production builds). Returns the canonical form: lower-case scheme and
 * host, no trailing slash, no query or fragment.
 *
 *  - a bare host ("crm.example.com") is assumed to be https
 *  - only http(s) is accepted (never file:, javascript:, ...)
 *  - plain http is allowed only when `allowHttp` is set (local/LAN testing)
 */
export function normalizeServerUrl(input: string, options: { allowHttp: boolean }): ServerUrlResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Enter the server address.' };

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  const match = PATTERN.exec(candidate);
  if (!match) return { ok: false, error: 'That does not look like a web address. Example: https://crm.example.com' };

  const scheme = match[1].toLowerCase();
  const hostPort = match[2].toLowerCase();
  const path = (match[3] ?? '').replace(/\/+$/, '');

  if (scheme === 'http' && !options.allowHttp) return { ok: false, error: 'This build only connects over https.' };

  const [host, port] = hostPort.split(':');
  if (!host || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return { ok: false, error: 'The server name is not valid.' };
  if (port !== undefined && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    return { ok: false, error: 'The port must be a number between 1 and 65535.' };
  }

  return { ok: true, url: `${scheme}://${hostPort}${path}` };
}

/** "crm.example.com:3000" for display. */
export function hostOf(url: string): string {
  const match = PATTERN.exec(url);
  return match ? match[2] : url;
}
