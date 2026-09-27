import { mobileJson } from '@/lib/mobileApi';

// Public, unauthenticated startup check for the mobile app: lets the backend
// force an upgrade (minAppVersion) or put the app into maintenance mode without
// shipping a new build. Values come from env so no deploy-time code change or
// database row is needed. Contains nothing sensitive.
export async function GET() {
  return mobileJson({
    minAppVersion: process.env.MOBILE_MIN_APP_VERSION || '1.0.0',
    latestAppVersion: process.env.MOBILE_LATEST_APP_VERSION || '1.0.0',
    maintenance: process.env.MOBILE_MAINTENANCE === 'true',
    maintenanceMessage: process.env.MOBILE_MAINTENANCE_MESSAGE || null,
  });
}
