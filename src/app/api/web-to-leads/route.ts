import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, recordFailedAttempt, getClientIp } from '@/lib/rateLimiter';
import { ingestWebToLead } from '@/lib/webToLeadsIngest';

// Public, unauthenticated intake endpoint (called cross-origin from the
// marketing site, and possibly other legacy Salesforce/Contact Form 7
// integrations — see the GET handler below) — throttle per source IP so it
// can't be used to flood the leads table or exhaust the DB, since there's no
// auth to rate-limit by user.
//
// Meta Lead Ads leads do NOT come through this HTTP endpoint — src/lib/meta/
// crm-delivery.ts calls ingestWebToLead() directly in-process, since this
// app is itself the CRM those leads are destined for.
const INTAKE_RATE_LIMIT = { windowMs: 10 * 60 * 1000, maxAttempts: 20 };

const corsHeaders = {
  'Access-Control-Allow-Origin': process.env.WEB_TO_LEADS_ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
};

const json = (body: unknown, init?: ResponseInit) => (
  NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders,
      ...(init?.headers || {}),
    },
  })
);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  return json({
    success: true,
    endpoint: '/api/web-to-leads',
    method: 'POST',
    requiredFields: ['lastName or your-name', 'email or your-email', 'phone or phonetext-718'],
    acceptsSalesforcePayload: true,
    acceptsContactForm7Payload: true,
    optionalFields: {
      branch: 'Branch name, abbreviation, or city; defaults to Dubai when omitted',
      DestinationCountry: 'Matches crm_country_proces.name/id',
      ImmigrationType: 'Matches crm_service.name/id',
      LeadSource: 'Matches crm_source.name/id',
      ResidentCountry: 'Stored as nationality/address text',
      MetaLeadId: 'Facebook leadgen_id, for Meta Lead Ads sources only — enables lead quality feedback',
    },
    storesReferenceIds: {
      country_interest: 'crm_country_proces.id',
      service_interest: 'crm_service.id',
      market_source: 'crm_source.id',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitKey = `web-to-leads:${getClientIp(request)}`;
    const rateLimit = checkRateLimit(rateLimitKey, INTAKE_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return json({ success: false, error: 'Too many submissions. Please try again later.' }, {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      });
    }
    recordFailedAttempt(rateLimitKey, INTAKE_RATE_LIMIT);

    const data = await request.json() as Record<string, unknown>;

    const { status, ...result } = await ingestWebToLead(data, {
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '',
      userAgent: request.headers.get('user-agent') || '',
      host: request.headers.get('host') || '',
    });

    return json(result, { status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error creating website lead:', error);
    return json(
      {
        success: false,
        error: 'Internal server error',
        message,
      },
      { status: 500 }
    );
  }
}
