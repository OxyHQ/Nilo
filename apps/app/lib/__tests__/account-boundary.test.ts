import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { enterAccount, sessionEnded, signOutOfDevice } from '../account-boundary';
import { pageDocStore } from '../editor/doc-store';
import { offlinePages } from '../editor/offline-pages';
import { withPageSessionsDrained } from '../editor/shared-sessions';
import { useCollapsedGroupsStore } from '../stores/collapsed-groups-store';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../editor/doc-store', () => ({
  pageDocStore: { clear: jest.fn(async () => undefined) },
}));
jest.mock('../editor/offline-pages', () => ({
  offlinePages: { clear: jest.fn(async () => undefined) },
}));
jest.mock('../editor/shared-sessions', () => ({
  withPageSessionsDrained: jest.fn(async (purge: () => Promise<void>) => purge()),
}));
// Releasing push on sign-out is `push-registration.test.ts`'s.
jest.mock('../push-registration', () => ({ unregisterPush: jest.fn(async () => undefined) }));

let client: QueryClient;
beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  client = new QueryClient();
  client.setQueryData(['pages', 'w'], { pages: ['secret'] });
});
afterEach(() => client.clear());

const cleared = () => {
  expect(client.getQueryData(['pages', 'w'])).toBeUndefined();
  expect(offlinePages.clear).toHaveBeenCalled();
  expect(pageDocStore?.clear).toHaveBeenCalled();
};
const kept = () => {
  expect(offlinePages.clear).not.toHaveBeenCalled();
  expect(pageDocStore?.clear).not.toHaveBeenCalled();
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

it('removes local collapsed group values when another account signs in', async () => {
  await enterAccount(client, 'ana');
  useCollapsedGroupsStore.getState().setCollapsed('view-a', ['private text']);
  await useCollapsedGroupsStore.persist.rehydrate();
  expect(await AsyncStorage.getItem('collapsed-groups')).toContain('private text');
  await enterAccount(client, 'bo');
  expect(useCollapsedGroupsStore.getState().byView).toEqual({});
  expect(await AsyncStorage.getItem('collapsed-groups')).not.toContain('private text');
});

it('retains local group preferences after a session ends and the same account returns', async () => {
  await enterAccount(client, 'ana');
  useCollapsedGroupsStore.getState().setCollapsed('view-a', ['personal preference']);
  await useCollapsedGroupsStore.persist.rehydrate();
  await sessionEnded('ana');
  await enterAccount(client, 'ana');
  expect(useCollapsedGroupsStore.getState().byView['view-a']).toEqual(['personal preference']);
  expect(await AsyncStorage.getItem('collapsed-groups')).toContain('personal preference');
});

it('removes local group preferences on explicit sign-out, including a same-account login', async () => {
  await enterAccount(client, 'ana');
  useCollapsedGroupsStore.getState().setCollapsed('view-a', ['private text']);
  await signOutOfDevice(client);
  // An old view can still write as it unmounts; the sign-out marker makes the
  // next login clear that write as well.
  useCollapsedGroupsStore.getState().setCollapsed('view-a', ['private text']);
  await enterAccount(client, 'ana');
  expect(useCollapsedGroupsStore.getState().byView).toEqual({});
  expect(await AsyncStorage.getItem('collapsed-groups')).not.toContain('private text');
});

it('does not restore an earlier group hydration over the next account', async () => {
  await enterAccount(client, 'ana');
  useCollapsedGroupsStore.getState().setCollapsed('view-a', ['private text']);
  await useCollapsedGroupsStore.persist.rehydrate();
  const read = jest.mocked(AsyncStorage.getItem).getMockImplementation();
  if (!read) throw new Error('AsyncStorage mock has no implementation');
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  let clearing!: () => void;
  const clearStarted = new Promise<void>((resolve) => {
    clearing = resolve;
  });
  if (!pageDocStore) throw new Error('Missing document store mock');
  jest.mocked(pageDocStore.clear).mockImplementationOnce(async () => {
    clearing();
  });
  const spy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async (key, callback) => {
    const value = await read(key, callback);
    if (key === 'collapsed-groups') {
      started();
      await pending;
    }
    return value;
  });
  try {
    const oldHydration = useCollapsedGroupsStore.persist.rehydrate();
    await began;
    const switching = enterAccount(client, 'bo');
    await clearStarted;
    release();
    await Promise.all([oldHydration, switching]);
    expect(useCollapsedGroupsStore.getState().byView).toEqual({});
    expect(await AsyncStorage.getItem('collapsed-groups')).not.toContain('private text');
  } finally {
    release();
    spy.mockImplementation(read);
  }
});

it('waits for an earlier group write before clearing the next account', async () => {
  await enterAccount(client, 'ana');
  await useCollapsedGroupsStore.persist.rehydrate();
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation();
  if (!write) throw new Error('AsyncStorage mock has no implementation');
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  let clearing!: () => void;
  const clearStarted = new Promise<void>((resolve) => {
    clearing = resolve;
  });
  if (!pageDocStore) throw new Error('Missing document store mock');
  jest.mocked(pageDocStore.clear).mockImplementationOnce(async () => {
    clearing();
  });
  const spy = jest
    .spyOn(AsyncStorage, 'setItem')
    .mockImplementation(async (key, value, callback) => {
      if (key === 'collapsed-groups' && value.includes('private text')) {
        started();
        await pending;
      }
      return write(key, value, callback);
    });
  try {
    useCollapsedGroupsStore.getState().setCollapsed('view-a', ['private text']);
    await began;
    const switching = enterAccount(client, 'bo');
    await clearStarted;
    let finished = false;
    void switching.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await switching;
    expect(useCollapsedGroupsStore.getState().byView).toEqual({});
    expect(await AsyncStorage.getItem('collapsed-groups')).not.toContain('private text');
  } finally {
    release();
    spy.mockImplementation(write);
  }
});

it('reports a failed persistent cleanup instead of claiming the old value was removed', async () => {
  await enterAccount(client, 'ana');
  useCollapsedGroupsStore.getState().setCollapsed('view-a', ['private text']);
  await useCollapsedGroupsStore.persist.rehydrate();
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation();
  if (!write) throw new Error('AsyncStorage mock has no implementation');
  const spy = jest.spyOn(AsyncStorage, 'setItem').mockImplementation((key, value, callback) => {
    if (key === 'collapsed-groups') return Promise.reject(new Error('storage unavailable'));
    return write(key, value, callback);
  });
  try {
    await expect(enterAccount(client, 'bo')).rejects.toThrow('storage unavailable');
    expect(useCollapsedGroupsStore.getState().byView).toEqual({});
    expect(await AsyncStorage.getItem('collapsed-groups')).toContain('private text');
    expect(await AsyncStorage.getItem('nilo:account')).toBe('ana');
  } finally {
    spy.mockImplementation(write);
  }
});

it('does not prevent an old callback from writing after account cleanup', async () => {
  await enterAccount(client, 'ana');
  const oldCallback = () =>
    useCollapsedGroupsStore.getState().setCollapsed('view-a', ['late private text']);
  await enterAccount(client, 'bo');
  oldCallback();
  await useCollapsedGroupsStore.persist.rehydrate();
  expect(await AsyncStorage.getItem('collapsed-groups')).toContain('late private text');
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

it('does not clear device data until session persistence has drained', async () => {
  await enterAccount(client, 'ana');
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  jest.mocked(withPageSessionsDrained).mockImplementationOnce(async (purge) => {
    began();
    await pending;
    return purge();
  });
  const signingOut = signOutOfDevice(client);
  await started;
  kept();
  release();
  await signingOut;
  cleared();
});
