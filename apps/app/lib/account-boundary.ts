/**
 * What the app keeps on the device outside the SDK's per-account query cache —
 * pages kept offline and work not yet sent — belongs to one account. When
 * another account signs in, all of it goes, so no one sees another's pages
 * and no change is sent in someone else's name.
 *
 * The device's owner is recorded as the account id, or as a mark left by a
 * sign-out:
 *
 * - `signed-out` (signing out from Nilo): whoever signs in next starts clean,
 *   the same account included. Anything written after the sign-out — an
 *   editor saving as it unmounts — is cleared then too.
 * - `signed-out:<id>` (the session ended elsewhere, from Oxy's own account
 *   sheet): that account keeps its pages; anyone else starts clean.
 *
 * A session still being restored decides nothing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';
import { pageDocStore } from './editor/doc-store';
import { offlinePages } from './editor/offline-pages';
import { withPageSessionsDrained } from './editor/shared-sessions';
import { unregisterPush } from './push-registration';
import { clearCollapsedGroups } from './stores/collapsed-groups-store';

const OWNER_KEY = 'nilo:account';
const SIGNED_OUT = 'signed-out';

/** How long signing out waits for the API to stop sending push to the device. */
const PUSH_RELEASE_MS = 3000;

const readOwner = () => AsyncStorage.getItem(OWNER_KEY).catch(() => null);
const writeOwner = (value: string) => AsyncStorage.setItem(OWNER_KEY, value).catch(() => undefined);

async function clearDevice(client: QueryClient): Promise<void> {
  await withPageSessionsDrained(async () => {
    client.clear();
    // The pages kept offline, and every document stored, unsent work included.
    // Session writes have settled and cannot recreate data after this purge.
    await offlinePages.clear();
    await pageDocStore?.clear().catch(() => undefined);
    await clearCollapsedGroups();
  });
}

/**
 * Before signing out from Nilo, while the session still lasts: the API stops
 * sending the account's notifications to this device (an Expo token, or the
 * browser's Web Push subscription, which the next account takes over).
 * Bounded, so an unreachable API never holds the sign-out.
 */
export async function releaseDevice(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    unregisterPush({ unsubscribe: false }),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PUSH_RELEASE_MS);
    }),
  ]);
  clearTimeout(timer);
}

/**
 * Signing out from Nilo: the next account, whoever it is, starts clean. The
 * mark goes first, so what is written while the app unmounts is cleared too.
 */
export async function signOutOfDevice(client: QueryClient): Promise<void> {
  await writeOwner(SIGNED_OUT);
  await clearDevice(client);
}

/** The session ended without Nilo signing out (Oxy's own sheet): only another account starts clean. */
export async function sessionEnded(userId: string): Promise<void> {
  const owner = await readOwner();
  if (owner === userId) await writeOwner(`${SIGNED_OUT}:${userId}`);
}

/** `userId` is using the app: if the device's data was another account's, or signed out of, it goes. */
export async function enterAccount(client: QueryClient, userId: string): Promise<void> {
  const owner = await readOwner();
  if (owner === userId) return;
  if (owner !== null && owner !== `${SIGNED_OUT}:${userId}`) await clearDevice(client);
  await writeOwner(userId);
}
