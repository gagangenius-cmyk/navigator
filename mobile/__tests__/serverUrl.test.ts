import { hostOf, normalizeServerUrl } from '@/utils/serverUrl';

const lan = { allowHttp: true };
const strict = { allowHttp: false };

describe('normalizeServerUrl', () => {
  it('accepts and canonicalises a valid address', () => {
    expect(normalizeServerUrl('https://CRM.Example.com/', lan)).toEqual({ ok: true, url: 'https://crm.example.com' });
    expect(normalizeServerUrl('  https://crm.example.com///  ', lan)).toEqual({ ok: true, url: 'https://crm.example.com' });
    expect(normalizeServerUrl('http://192.168.0.10:3000', lan)).toEqual({ ok: true, url: 'http://192.168.0.10:3000' });
  });

  it('assumes https for a bare host', () => {
    expect(normalizeServerUrl('crm.example.com', lan)).toEqual({ ok: true, url: 'https://crm.example.com' });
    expect(normalizeServerUrl('crm.example.com:8443', lan)).toEqual({ ok: true, url: 'https://crm.example.com:8443' });
  });

  it('keeps a sub-path but drops query strings and fragments', () => {
    expect(normalizeServerUrl('https://example.com/crm/?a=1#x', lan)).toEqual({ ok: true, url: 'https://example.com/crm' });
  });

  it('only allows plain http when the build permits it', () => {
    expect(normalizeServerUrl('http://192.168.0.10:3000', strict)).toEqual({ ok: false, error: 'This build only connects over https.' });
    expect(normalizeServerUrl('https://crm.example.com', strict).ok).toBe(true);
  });

  it('rejects other schemes, credentials and junk', () => {
    for (const bad of ['', '   ', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'https://user:pw@example.com', 'https://', 'not a url', 'https://exa mple.com', 'https://-bad-.com']) {
      expect(normalizeServerUrl(bad, lan).ok).toBe(false);
    }
  });

  it('validates the port', () => {
    expect(normalizeServerUrl('http://10.0.0.1:0', lan).ok).toBe(false);
    expect(normalizeServerUrl('http://10.0.0.1:70000', lan).ok).toBe(false);
    expect(normalizeServerUrl('http://10.0.0.1:abc', lan).ok).toBe(false);
    expect(normalizeServerUrl('http://10.0.0.1:65535', lan).ok).toBe(true);
  });
});

describe('hostOf', () => {
  it('shows host and port only', () => {
    expect(hostOf('https://crm.example.com/api')).toBe('crm.example.com');
    expect(hostOf('http://10.118.1.68:3000')).toBe('10.118.1.68:3000');
  });
});
