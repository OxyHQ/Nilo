/**
 * What the app keeps on the device belongs to one account: the kept queries,
 * the pages kept offline, the work not yet sent. When another account signs
 * in, or the member signs out, all of it goes, so no one sees another's pages
 * and no change is sent in someone else's name.
 *
 * A session still being restored (no user yet) changes nothing: offline, that
 * is exactly when what is kept is needed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { clearAllSavedPages } from './editor/offline';
import { offlinePages } from './editor/offline-pages';
import { shellPersister } from './offline-cache';

const ACCOUNT_KEY = 'nilo:account';

/** Remove everything kept on the device for the account using it. */
export async function forgetDeviceData(client: QueryClient): Promise<void> {
  client.clear();
  await Promise.all([
    shellPersister.removeClient(),
    offlinePages.clear(),
    clearAllSavedPages(),
    AsyncStorage.removeItem(ACCOUNT_KEY).catch(() => undefined),
  ]);
}

/** `userId` is using the app: if the device's data was another account's, it goes. */
export async function enterAccount(client: QueryClient, userId: string): Promise<void> {
  const previous = await AsyncStorage.getItem(ACCOUNT_KEY).catch(() => null);
  if (previous === userId) return;
  if (previous !== null) await forgetDeviceData(client);
  await AsyncStorage.setItem(ACCOUNT_KEY, userId).catch(() => undefined);
}
