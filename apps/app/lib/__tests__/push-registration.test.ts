import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import apiClient from '@/lib/api/client';
import { releaseDevice } from '../account-boundary';
import { isPushDisabled, readPushState, setPushEnabled } from '../push-registration';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({ data: { publicKey: 'AQAB' } })),
    post: jest.fn(async () => ({ data: { success: true } })),
    delete: jest.fn(async () => ({ data: { success: true } })),
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'project' } } } },
}));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[device]' })),
}));
jest.mock('../editor/doc-store', () => ({ pageDocStore: null }));
jest.mock('../editor/offline-pages', () => ({ offlinePages: { clear: jest.fn() } }));

const api = apiClient as unknown as Record<'get' | 'post' | 'delete', jest.Mock>;
const os = Platform.OS;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});
afterEach(() => {
  Platform.OS = os;
});

describe('push on a phone', () => {
  it('turned off, stops the API sending to this device and stays off', async () => {
    const state = await setPushEnabled(false);
    expect(api.delete).toHaveBeenCalledWith('/notifications/push-token', {
      data: { token: 'ExponentPushToken[device]' },
    });
    expect(await isPushDisabled()).toBe(true);
    expect(state).toEqual({ supported: true, permission: 'granted', enabled: false });
  });

  it('turned on again, registers this device', async () => {
    await setPushEnabled(false);
    const state = await setPushEnabled(true);
    expect(api.post).toHaveBeenCalledWith('/notifications/push-token', {
      token: 'ExponentPushToken[device]',
      platform: Platform.OS,
    });
    expect(await isPushDisabled()).toBe(false);
    expect(state.enabled).toBe(true);
  });

  it('is released when its account signs out', async () => {
    await releaseDevice();
    expect(api.delete).toHaveBeenCalledWith('/notifications/push-token', {
      data: { token: 'ExponentPushToken[device]' },
    });
  });
});

describe('push in a browser', () => {
  const subscription = {
    endpoint: 'https://push.example.test/sub',
    unsubscribe: jest.fn(async () => true),
    toJSON: () => ({ endpoint: 'https://push.example.test/sub', keys: { p256dh: 'p', auth: 'a' } }),
  };
  let subscribed: typeof subscription | null;
  const registration = {
    pushManager: {
      getSubscription: jest.fn(async () => subscribed),
      subscribe: jest.fn(async () => subscription),
    },
  };
  const globals = globalThis as unknown as Record<string, unknown>;

  beforeEach(() => {
    Platform.OS = 'web';
    subscribed = subscription;
    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: jest.fn(async () => registration),
        register: jest.fn(async () => registration),
        ready: Promise.resolve(registration),
      },
    });
    globals.PushManager = function PushManager() {};
    globals.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
  });
  afterEach(() => {
    delete (globalThis.navigator as unknown as Record<string, unknown>).serviceWorker;
    delete globals.PushManager;
    delete globals.Notification;
  });

  it('shows what the browser is really registered for', async () => {
    expect(await readPushState()).toEqual({
      supported: true,
      permission: 'granted',
      enabled: true,
    });
    subscribed = null;
    expect((await readPushState()).enabled).toBe(false);
  });

  it('turned off, stops the API sending here and drops the subscription', async () => {
    const state = await setPushEnabled(false);
    expect(api.delete).toHaveBeenCalledWith('/notifications/web-push-subscription', {
      data: { endpoint: 'https://push.example.test/sub' },
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(state.enabled).toBe(false);
  });

  it('signing out releases it for the API but keeps the subscription for the next account', async () => {
    await releaseDevice();
    expect(api.delete).toHaveBeenCalledWith('/notifications/web-push-subscription', {
      data: { endpoint: 'https://push.example.test/sub' },
    });
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});
