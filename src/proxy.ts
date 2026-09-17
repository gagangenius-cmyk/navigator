import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { getJwtSecret } from '@/lib/jwtSecret';

// Edge-safe mirror of src/lib/auth.ts's verifyToken(): that file pulls in
// jsonwebtoken + sequelize (Node-only), which can't run in middleware, so
// this uses `jose` against the same HS256 secret/algorithm instead. Every
// /admin page already re-checks auth client-side via ProtectedRoute
// (src/components/auth/ProtectedRoute.tsx) and every API route re-checks via
// requireAuth() (src/lib/apiAuth.ts) - this is a first line of defense so an
// unauthenticated request never even reaches the admin page shell, not a
// replacement for either.
const encodedSecret = new TextEncoder().encode(getJwtSecret());

async function hasValidStaffSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get('auth-token')?.value;
  if (!token) return false;

  try {
    const { payload } = await jwtVerify(token, encodedSecret, { algorithms: ['HS256'] });
    // A client-portal token (src/lib/clientAuth.ts) carries principalType:'client'
    // and must never satisfy the staff gate, matching requireAuth()'s own check.
    return payload.principalType !== 'client';
  } catch {
    return false;
  }
}

// Next.js 16 renamed the middleware convention to "proxy" - this file must
// live at src/proxy.ts and export a function named `proxy` (or default).
export async function proxy(request: NextRequest) {
  if (await hasValidStaffSession(request)) {
    return NextResponse.next();
  }

  const loginUrl = new URL('/login', request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin/:path*'],
};
