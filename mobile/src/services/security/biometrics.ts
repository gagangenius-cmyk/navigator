import * as LocalAuthentication from 'expo-local-authentication';

export interface BiometricSupport {
  /** Hardware present AND the user has enrolled a fingerprint/face or a device passcode. */
  available: boolean;
  /** Human label for prompts: "Face ID", "Fingerprint", "Device passcode". */
  label: string;
}

export async function getBiometricSupport(): Promise<BiometricSupport> {
  try {
    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    if (!hasHardware || !enrolled) return { available: false, label: 'Device passcode' };
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return { available: true, label: 'Face ID' };
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return { available: true, label: 'Fingerprint' };
    return { available: true, label: 'Biometrics' };
  } catch {
    return { available: false, label: 'Device passcode' };
  }
}

export type AuthOutcome = 'success' | 'cancelled' | 'failed' | 'unavailable';

/**
 * Prompts for biometrics, falling back to the device passcode when biometrics
 * fail or aren't enrolled. Used to unlock the app and to confirm every approval.
 */
export async function authenticate(reason: string): Promise<AuthOutcome> {
  try {
    const support = await getBiometricSupport();
    if (!support.available) return 'unavailable';
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      // Allow the device passcode as a fallback - a locked-out user must still be able to work.
      disableDeviceFallback: false,
    });
    if (result.success) return 'success';
    return result.error === 'user_cancel' || result.error === 'system_cancel' || result.error === 'app_cancel' ? 'cancelled' : 'failed';
  } catch {
    return 'failed';
  }
}
