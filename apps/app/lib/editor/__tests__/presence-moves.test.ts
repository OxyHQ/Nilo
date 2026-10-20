import { withMove } from '../presence-focus';

const alice = { userId: 'alice', blockId: 'b1', selection: null };
const bob = { userId: 'bob', blockId: null, selection: null };

it('puts a member who moved in their place, and keeps everyone else as they were', () => {
  const list = [alice, bob];
  const next = withMove(list, { userId: 'alice', blockId: 'b2', selection: null });
  expect(next).toEqual([{ userId: 'alice', blockId: 'b2', selection: null }, bob]);
  expect(next[1]).toBe(bob);
  expect(list[0]).toBe(alice);
});

it('adds a member whose move arrives before the list that has them', () => {
  expect(withMove([bob], alice)).toEqual([bob, alice]);
});
