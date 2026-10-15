import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { enterAccount, forgetDeviceData } from '../account-boundary';
import { clearAllSavedPages } from '../editor/offline';
import { offlinePages } from '../editor/offline-pages';
import { shellPersister } from '../offline-cache';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../editor/offline', () => ({ clearAllSavedPages: jest.fn(async () => undefined) }));
jest.mock('../editor/offline-pages', () => ({
  offlinePages: { clear: jest.fn(async () => undefined) },
}));
jest.mock('../offline-cache', () => ({
  shellPersister: { removeClient: jest.fn(async () => undefined) },
}));

let client: QueryClient;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  client = new QueryClient();
  client.setQueryData(['pages', 'w'], { pages: ['secret'] });
});

const forgotten = () => {
  expect(client.getQueryData(['pages', 'w'])).toBeUndefined();
  expect(shellPersister.removeClient).toHaveBeenCalled();
  expect(offlinePages.clear).toHaveBeenCalled();
  expect(clearAllSavedPages).toHaveBeenCalled();
};

it('takes the device for the first account without removing anything', async () => {
  await enterAccount(client, 'ana');
  expect(await AsyncStorage.getItem('nilo:account')).toBe('ana');
  expect(client.getQueryData(['pages', 'w'])).toEqual({ pages: ['secret'] });
  expect(offlinePages.clear).not.toHaveBeenCalled();
});

it('keeps everything for the same account', async () => {
  await enterAccount(client, 'ana');
  await enterAccount(client, 'ana');
  expect(offlinePages.clear).not.toHaveBeenCalled();
});

it('removes everything the device kept when another account signs in', async () => {
  await enterAccount(client, 'ana');
  await enterAccount(client, 'bo');
  forgotten();
  expect(await AsyncStorage.getItem('nilo:account')).toBe('bo');
});

it('removes everything on signing out, and the next account starts afresh', async () => {
  await enterAccount(client, 'ana');
  await forgetDeviceData(client);
  forgotten();
  expect(await AsyncStorage.getItem('nilo:account')).toBeNull();
  jest.clearAllMocks();
  await enterAccount(client, 'bo');
  expect(offlinePages.clear).not.toHaveBeenCalled();
});
