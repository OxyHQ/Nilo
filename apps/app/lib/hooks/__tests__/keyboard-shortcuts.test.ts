import { QUICK_FIND_KEYS, SHORTCUT_KEYS, shortcutFor } from '../use-keyboard-shortcuts';

jest.mock('@/lib/stores/ui-store', () => ({ useUIStore: jest.fn() }));
jest.mock('@/lib/stores/workspace-store', () => ({ useWorkspaceStore: jest.fn() }));
jest.mock('@/lib/stores/new-page-store', () => ({ useNewPageStore: jest.fn() }));

const press = (key: string, mods: Partial<KeyboardEvent> = {}, code = '') => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('app-wide shortcuts', () => {
  it('opens a new page with Mod+Alt+N, wherever Option puts the letter', () => {
    expect(shortcutFor(press('n', { ctrlKey: true, altKey: true }, 'KeyN'), false)).toBe('newPage');
    // Option+N on a Mac types a dead key, not "n".
    expect(shortcutFor(press('Dead', { metaKey: true, altKey: true }, 'KeyN'), true)).toBe(
      'newPage',
    );
    expect(SHORTCUT_KEYS.newPage).toEqual(['Mod', 'Alt', 'N']);
  });

  it('leaves Mod+N and Mod+[ to the browser', () => {
    expect(shortcutFor(press('n', { metaKey: true }, 'KeyN'), false)).toBeNull();
    expect(shortcutFor(press('[', { metaKey: true }), false)).toBeNull();
  });

  it('opens the quick find with Mod+P, in a text field too', () => {
    expect(shortcutFor(press('p', { metaKey: true }), true)).toBe('palette');
    expect(shortcutFor(press('P', { ctrlKey: true }), false)).toBe('palette');
    expect(shortcutFor(press('p', { metaKey: true, shiftKey: true }), false)).toBeNull();
    expect(QUICK_FIND_KEYS).toEqual(['Mod', 'P']);
  });

  it('keeps the palette, the sidebar and the shortcuts dialog', () => {
    expect(shortcutFor(press('k', { metaKey: true }), true)).toBe('palette');
    expect(shortcutFor(press('\\', { ctrlKey: true }), false)).toBe('sidebar');
    expect(shortcutFor(press('/', { ctrlKey: true }), false)).toBe('shortcuts');
    // An editor keeps its own Mod+/.
    expect(shortcutFor(press('/', { ctrlKey: true }), true)).toBeNull();
    expect(shortcutFor(press('k'), false)).toBeNull();
  });
});
