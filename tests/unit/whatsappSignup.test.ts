import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeEmbeddedSignup, parseSignupInput, SignupError } from '../../src/lib/meta/whatsapp-signup';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('parseSignupInput', () => {
  it('accepts a valid body and normalizes ids', () => {
    expect(parseSignupInput({ code: ' abc ', wabaId: 123456789012, phoneNumberId: '987654321' }))
      .toEqual({ code: 'abc', wabaId: '123456789012', phoneNumberId: '987654321' });
  });

  it('treats phoneNumberId as optional', () => {
    expect(parseSignupInput({ code: 'abc', wabaId: '123456789012' }).phoneNumberId).toBeNull();
  });

  it.each([
    [null],
    [{}],
    [{ code: '', wabaId: '123456789012' }],
    [{ code: 'abc', wabaId: 'not-a-number' }],
    [{ code: 'abc', wabaId: '12345678; DROP' }],
    [{ code: 'abc', wabaId: '123456789012', phoneNumberId: 'x/../y' }],
    [{ code: 'x'.repeat(3000), wabaId: '123456789012' }],
  ])('rejects invalid input %#', (body) => {
    expect(() => parseSignupInput(body)).toThrow(SignupError);
  });
});

describe('completeEmbeddedSignup', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.META_APP_ID = '111';
    process.env.META_APP_SECRET = 'app-secret-value';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const input = { code: 'the-code', wabaId: '555000111222', phoneNumberId: '777' };

  it('exchanges the code, subscribes the WABA and reports the number', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'biz-token' }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ data: [{ id: '777', display_phone_number: '+971 55 947 6936', status: 'CONNECTED', is_on_biz_app: true, platform_type: 'CLOUD_API' }] }));

    const result = await completeEmbeddedSignup(input);

    expect(result.subscribed).toBe(true);
    expect(result.phone).toMatchObject({ id: '777', displayPhoneNumber: '+971 55 947 6936', status: 'CONNECTED', isOnBizApp: true });

    const [exchangeUrl] = fetchMock.mock.calls[0];
    expect(String(exchangeUrl)).toContain('/oauth/access_token');
    expect(String(exchangeUrl)).toContain('code=the-code');
    const [subUrl, subInit] = fetchMock.mock.calls[1];
    expect(String(subUrl)).toContain('/555000111222/subscribed_apps');
    expect(subInit.method).toBe('POST');
    expect(subInit.headers.Authorization).toBe('Bearer biz-token');
  });

  it('surfaces Meta errors without leaking the token', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { message: 'Invalid verification code' } }, 400));
    const err = await completeEmbeddedSignup(input).catch((e) => e);
    expect(err).toBeInstanceOf(SignupError);
    expect(err.message).toBe('Invalid verification code');
    expect(err.status).toBe(400);
    expect(err.message).not.toContain('app-secret-value');
  });

  it('fails when Meta does not confirm the subscription', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'biz-token' }))
      .mockResolvedValueOnce(json({ success: false }));
    await expect(completeEmbeddedSignup(input)).rejects.toThrow(/subscription/);
  });

  it('reports a missing app configuration', async () => {
    delete process.env.META_APP_SECRET;
    const err = await completeEmbeddedSignup(input).catch((e) => e);
    expect(err).toBeInstanceOf(SignupError);
    expect(err.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a network failure to a gateway timeout', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const err = await completeEmbeddedSignup(input).catch((e) => e);
    expect(err.status).toBe(504);
  });
});
