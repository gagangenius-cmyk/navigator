import { NextResponse } from 'next/server';
import { getClientIp } from './rateLimiter';
import { parsePlatform } from './mobileDevices';
import type { MobileSessionMeta } from './mobileAuth';

// Shared plumbing for the /api/mobile/* routes. Failures are always
// `{ error, code? }` (the shape requireAuth already returns), never the web
// auth routes' `{ message }`.

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function mobileJson(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function mobileError(error: string, status: number, code?: string, headers: Record<string, string> = {}) {
  return mobileJson(code ? { error, code } : { error }, status, headers);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function stringField(body: Record<string, unknown>, key: string, max = 512): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function sessionMeta(request: Request, body: Record<string, unknown>): MobileSessionMeta {
  return {
    deviceName: stringField(body, 'deviceName', 150) || null,
    platform: parsePlatform(body.platform),
    ip: getClientIp(request),
  };
}
