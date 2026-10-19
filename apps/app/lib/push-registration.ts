/**
 * This device's push registration with the API: an Expo push token on a
 * phone, a Web Push subscription in a browser (`routes/notifications.ts`).
 *
 * The app registers on its own once signed in (`use-notification-setup.ts`)
 * unless the member turned push off on this device, which is remembered so
 * the next launch does not register again. Turning it off and signing out
 * both tell the API to stop sending here; signing out keeps the browser's
 * subscription, which the next account to sign in takes over.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import apiClient from '@/lib/api/client';

const DISABLED_KEY = 'nilo:push-disabled';
const PROJECT_ID = Constants.expoConfig?.extra?.eas?.projectId;
const SERVICE_WORKER = '/sw.js';

export interface PushState {
  /** Whether this device can receive push at all (a browser without Web Push cannot). */
  supported: boolean;
  /** What the device answered when asked, `undetermined` before asking. */
  permission: 'granted' | 'denied' | 'undetermined';
  /** Registered, and not turned off on this device. */
  enabled: boolean;
}

export async function isPushDisabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(DISABLED_KEY).catch(() => null)) === '1';
}

function webPushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window
  );
}

function webPermission(): PushState['permission'] {
  const permission = typeof Notification === 'undefined' ? 'default' : Notification.permission;
  return permission === 'default' ? 'undetermined' : permission;
}

async function webSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** The device's Expo push token, when it may show notifications. */
async function nativeToken(): Promise<string | null> {
  if (!PROJECT_ID) return null;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID })).data || null;
}

/** Convert a base64url-encoded VAPID key to an ArrayBuffer for PushManager.subscribe. */
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return buffer;
}

/**
 * Register this device for the signed-in member, asking for permission if it
 * was never given. True when the API now sends here.
 */
export async function registerPush(): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (!webPushSupported()) return false;
    const { data: vapid } = await apiClient.get('/notifications/vapid-public-key');
    if (!vapid?.publicKey) return false;
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER);
    await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      if ((await Notification.requestPermission()) !== 'granted') return false;
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(vapid.publicKey),
      });
    }
    const { endpoint, keys } = subscription.toJSON();
    await apiClient.post('/notifications/web-push-subscription', { endpoint, keys });
    return true;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const { status } = await Notifications.getPermissionsAsync();
  if (
    status !== 'granted' &&
    (await Notifications.requestPermissionsAsync()).status !== 'granted'
  ) {
    return false;
  }
  const token = await nativeToken();
  if (!token) return false;
  await apiClient.post('/notifications/push-token', { token, platform: Platform.OS });
  return true;
}

/**
 * Tell the API to stop sending to this device, while the session still
 * lasts. `unsubscribe` also drops the browser's subscription (turning push
 * off); signing out keeps it. Never throws: a device that cannot be told
 * about is left as it is.
 */
export async function unregisterPush({ unsubscribe }: { unsubscribe: boolean }): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (!webPushSupported()) return;
      const subscription = await webSubscription();
      if (!subscription) return;
      await apiClient
        .delete('/notifications/web-push-subscription', {
          data: { endpoint: subscription.endpoint },
        })
        .catch(() => undefined);
      if (unsubscribe) await subscription.unsubscribe();
      return;
    }
    const token = await nativeToken();
    if (token) {
      await apiClient.delete('/notifications/push-token', { data: { token } });
    }
  } catch {
    // Not registered, or the API is unreachable: nothing more to do here.
  }
}

/** Whether this device gets push now, for the notifications screen's switch. */
export async function readPushState(): Promise<PushState> {
  const disabled = await isPushDisabled();
  if (Platform.OS === 'web') {
    if (!webPushSupported())
      return { supported: false, permission: 'undetermined', enabled: false };
    const permission = webPermission();
    const subscribed = permission === 'granted' && (await webSubscription()) !== null;
    return { supported: true, permission, enabled: subscribed && !disabled };
  }
  const { status } = await Notifications.getPermissionsAsync();
  const permission = status === 'granted' || status === 'denied' ? status : 'undetermined';
  return { supported: true, permission, enabled: permission === 'granted' && !disabled };
}

/** Turn push on or off on this device, and remember it. */
export async function setPushEnabled(enabled: boolean): Promise<PushState> {
  if (enabled) {
    await AsyncStorage.removeItem(DISABLED_KEY).catch(() => undefined);
    await registerPush().catch(() => false);
  } else {
    await AsyncStorage.setItem(DISABLED_KEY, '1').catch(() => undefined);
    await unregisterPush({ unsubscribe: true });
  }
  return readPushState();
}
