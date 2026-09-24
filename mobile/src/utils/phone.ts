import { Alert, Linking } from 'react-native';

/** Keeps a leading + and digits only. */
export function cleanPhone(phone: string | null | undefined): string {
  const trimmed = (phone ?? '').trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  return trimmed.startsWith('+') ? `+${digits}` : digits;
}

export const dialUrl = (phone: string) => `tel:${cleanPhone(phone)}`;
export const whatsappUrl = (phone: string) => `https://wa.me/${cleanPhone(phone).replace(/^\+/, '')}`;

async function open(url: string, failure: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to open', failure);
  }
}

export function callPhone(phone: string | null | undefined): Promise<void> {
  if (!cleanPhone(phone)) {
    Alert.alert('No phone number', 'This lead has no phone number on file.');
    return Promise.resolve();
  }
  return open(dialUrl(phone as string), 'This device cannot place calls.');
}

export function openWhatsApp(phone: string | null | undefined): Promise<void> {
  if (!cleanPhone(phone)) {
    Alert.alert('No phone number', 'This lead has no phone number on file.');
    return Promise.resolve();
  }
  return open(whatsappUrl(phone as string), 'WhatsApp is not available on this device.');
}
