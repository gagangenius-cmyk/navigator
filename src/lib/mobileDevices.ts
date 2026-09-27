import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import { ensureMobileTables } from './mobileSchema';
import {
  isValidPushToken,
  parseEnvironment,
  parsePlatform,
  type ApnsEnvironment,
  type MobilePlatform,
} from './mobileDevicesCore';

export { isValidPushToken, parseEnvironment, parsePlatform };
export type { ApnsEnvironment, MobilePlatform };

// Push-device registry. One row per native push token: an FCM registration
// token on Android, a raw APNs device token on iOS. The token is unique, so a
// phone that is handed to another employee re-binds instead of continuing to
// receive the previous user's notifications.

export interface MobileDeviceInput {
  token: string;
  platform: MobilePlatform;
  environment?: ApnsEnvironment | null;
  deviceName?: string | null;
  appVersion?: string | null;
}

export interface MobileDevice {
  push_token: string;
  platform: MobilePlatform;
  environment: ApnsEnvironment | null;
}

export async function registerMobileDevice(employeeId: number, input: MobileDeviceInput): Promise<void> {
  await ensureMobileTables();
  await sequelize.query(
    `INSERT INTO crm_mobile_devices
       (employee_id, push_token, platform, environment, device_name, app_version, is_active, last_seen_at)
     VALUES (:employeeId, :token, :platform, :environment, :deviceName, :appVersion, 1, NOW())
     ON DUPLICATE KEY UPDATE
       employee_id = VALUES(employee_id),
       platform = VALUES(platform),
       environment = VALUES(environment),
       device_name = VALUES(device_name),
       app_version = VALUES(app_version),
       is_active = 1,
       last_seen_at = NOW()`,
    {
      replacements: {
        employeeId,
        token: input.token,
        platform: input.platform,
        environment: input.platform === 'ios' ? input.environment ?? null : null,
        deviceName: input.deviceName?.slice(0, 150) ?? null,
        appVersion: input.appVersion?.slice(0, 30) ?? null,
      },
    },
  );
}

/** Deactivates a token, but only if it belongs to the given employee. */
export async function unregisterMobileDevice(employeeId: number, token: string): Promise<void> {
  await ensureMobileTables();
  await sequelize.query(
    `UPDATE crm_mobile_devices SET is_active = 0 WHERE employee_id = :employeeId AND push_token = :token`,
    { replacements: { employeeId, token } },
  );
}

/** Deactivates tokens the push providers reported as dead (uninstalled, expired). */
export async function deactivateMobileDevices(tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  await ensureMobileTables();
  await sequelize.query(`UPDATE crm_mobile_devices SET is_active = 0 WHERE push_token IN (:tokens)`, {
    replacements: { tokens },
  });
}

export async function getActiveMobileDevices(employeeId: number): Promise<MobileDevice[]> {
  await ensureMobileTables();
  return sequelize.query<MobileDevice>(
    `SELECT push_token, platform, environment
     FROM crm_mobile_devices
     WHERE employee_id = :employeeId AND is_active = 1`,
    { replacements: { employeeId }, type: QueryTypes.SELECT },
  );
}
