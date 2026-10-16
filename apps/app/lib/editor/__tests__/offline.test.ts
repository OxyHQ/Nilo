import { TRANSACTION_KEY_RETENTION_MS } from '@oxy.so/nilo-contracts';
import type { PendingTransaction } from '@oxy.so/bloom-editor/model';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PendingClock, readSavedPage, type SavedPage, writeSavedPage } from '../offline';
import { OrderBook } from '../wire';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const change = (key: string): PendingTransaction => ({ key, tx: { ops: [] } });

const saved = (oldestAt: number): SavedPage => ({
  version: 3,
  base: { root: [], blocks: {} } as unknown as SavedPage['base'],
  pending: [change('a')],
  orders: [['block', 1024, 3]],
  oldestAt,
});

describe('PendingClock', () => {
  it('dates saved work by its oldest change, not by the last save', () => {
    const clock = new PendingClock();
    expect(clock.oldest([change('a')], 1000)).toBe(1000);
    // Later saves while `a` is still pending keep its date.
    expect(clock.oldest([change('a'), change('b')], 5000)).toBe(1000);
    // Once `a` is confirmed, the oldest is `b`.
    expect(clock.oldest([change('b')], 9000)).toBe(5000);
  });

  it('keeps the date of work read back from the device', () => {
    const clock = new PendingClock();
    clock.seed([change('a')], 200);
    expect(clock.oldest([change('a'), change('b')], 9000)).toBe(200);
  });
});

describe('saved pages', () => {
  beforeEach(() => AsyncStorage.clear());

  it('reads back what was written', async () => {
    await writeSavedPage('p1', saved(1000));
    expect(await readSavedPage('p1', 2000)).toEqual(saved(1000));
  });

  it('drops work older than the server remembers keys for', async () => {
    await writeSavedPage('p1', saved(0));
    expect(await readSavedPage('p1', TRANSACTION_KEY_RETENTION_MS)).toBeNull();
    // And forgets it.
    expect(await AsyncStorage.getItem('nilo:editor:p1')).toBeNull();
  });
});

describe('OrderBook persistence', () => {
  it('round-trips orders with their versions', () => {
    const book = OrderBook.from([
      ['a', 1024, 2],
      ['b', 2048, 5],
    ]);
    expect(OrderBook.from(book.toJSON()).toJSON()).toEqual(book.toJSON());
    expect(book.toJSON()).toEqual([
      ['a', 1024, 2],
      ['b', 2048, 5],
    ]);
  });
});
