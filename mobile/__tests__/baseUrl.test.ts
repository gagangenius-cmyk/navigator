/* eslint-disable import/first -- jest.mock() calls must run before the modules they replace are imported */
let mockOverride: string | null = null;
let mockAllowOverride = true;
let mockIsProduction = false;
let mockDefaultUrl = 'https://default.example.com';

jest.mock('@/constants/config', () => ({
  get API_BASE_URL() {
    return mockDefaultUrl;
  },
  get ALLOW_SERVER_OVERRIDE() {
    return mockAllowOverride;
  },
  get IS_PRODUCTION() {
    return mockIsProduction;
  },
}));
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({ serverUrl: mockOverride }) } }));

import { getApiBaseUrl, getConfigProblem } from '@/services/api/baseUrl';

beforeEach(() => {
  mockOverride = null;
  mockAllowOverride = true;
  mockIsProduction = false;
  mockDefaultUrl = 'https://default.example.com';
});

describe('getApiBaseUrl', () => {
  it('uses the build default when there is no override', () => {
    expect(getApiBaseUrl()).toBe('https://default.example.com');
  });

  it('honours a tester-entered server in internal builds', () => {
    mockOverride = 'http://192.168.0.10:3000/';
    expect(getApiBaseUrl()).toBe('http://192.168.0.10:3000');
  });

  it('ignores any stored override in production builds', () => {
    mockAllowOverride = false;
    mockIsProduction = true;
    mockOverride = 'https://evil.example.net';
    expect(getApiBaseUrl()).toBe('https://default.example.com');
  });
});

describe('getConfigProblem', () => {
  it('is fine with a default or override server', () => {
    expect(getConfigProblem()).toBeNull();
    mockOverride = 'http://192.168.0.10:3000';
    expect(getConfigProblem()).toBeNull();
  });

  it('refuses a non-https server in production builds', () => {
    mockAllowOverride = false;
    mockIsProduction = true;
    mockDefaultUrl = 'http://insecure.example.com';
    expect(getConfigProblem()).toMatch(/https/);
  });

  it('allows plain http in internal builds (LAN testing)', () => {
    mockDefaultUrl = 'http://10.118.1.68:3000';
    expect(getConfigProblem()).toBeNull();
  });

  it('reports a missing server', () => {
    mockDefaultUrl = '';
    expect(getConfigProblem()).toMatch(/No server/);
  });
});
