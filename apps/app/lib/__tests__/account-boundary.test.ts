import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { enterAccount, sessionEnded, signOutOfDevice } from '../account-boundary';
import { clearAllSavedPages } from '../editor/offline';
import { offlinePages } from '../editor/offline-pages';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../editor/offline', () => ({ clearAllSavedPages: jest.fn(async () => undefined) }));
jest.mock('../editor/offline-pages', () => ({
  offlinePages: { clear: jest.fn(async () => undefined) },
}));

let client: QueryClient;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  client = new QueryClient();
  client.setQueryData(['pages', 'w'], { pages: ['secret'] });
});

const cleared = () => {
  expect(client.getQueryData(['pages', 'w'])).toBeUndefined();
  expect(offlinePages.clear).toHaveBeenCalled();
  expect(clearAllSavedPages).toHaveBeenCalled();
};
const kept = () => {
  expect(offlinePages.clear).not.toHaveBeenCalled();
  expect(clearAllSavedPages).not.toHaveBeenCalled();
};

it('takes the device for the first account without removing anything', async () => {
  await enterAccount(client, 'ana');
  expect(await AsyncStorage.getItem('nilo:account')).toBe('ana');
  kept();
});

it('keeps everything for the same account', async () => {
  await enterAccount(client, 'ana');
  await enterAccount(client, 'ana');
  kept();
});

it('removes what the device kept when another account signs in', async () => {
  await enterAccount(client, 'ana');
  await enterAccount(client, 'bo');
  cleared();
  expect(await AsyncStorage.getItem('nilo:account')).toBe('bo');
});

it('after signing out of Nilo, clears what was written since, whoever signs in next', async () => {
  await enterAccount(client, 'ana');
  await signOutOfDevice(client);
  cleared();
  // The editor saving as it unmounts, after the sign-out cleared the device.
  jest.clearAllMocks();
  await enterAccount(client, 'bo');
  cleared();
  jest.clearAllMocks();
  await signOutOfDevice(client);
  jest.clearAllMocks();
  await enterAccount(client, 'bo');
  cleared();
});

it('when the session ended elsewhere, keeps the pages for the same account only', async () => {
  await enterAccount(client, 'ana');
  await sessionEnded('ana');
  await enterAccount(client, 'ana');
  kept();
  await sessionEnded('ana');
  await enterAccount(client, 'bo');
  cleared();
});

it('ignores a session ending for an account that does not own the device', async () => {
  await enterAccount(client, 'ana');
  await sessionEnded('someone-else');
  expect(await AsyncStorage.getItem('nilo:account')).toBe('ana');
});
