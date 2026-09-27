import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { CHANNELS } from './types';

// Android groups notifications into user-controllable channels. The server names
// the channel in each push (`channelId`), so these ids are part of the contract.
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(CHANNELS.default, {
    name: 'General',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#1F3B63',
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.leads, {
    name: 'New leads',
    description: 'A lead has been assigned to you',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250],
    lightColor: '#1F3B63',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync(CHANNELS.approvals, {
    name: 'Approvals',
    description: 'Discount, payment and compliance requests awaiting your decision',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 400, 200, 400],
    lightColor: '#D9331E',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}
