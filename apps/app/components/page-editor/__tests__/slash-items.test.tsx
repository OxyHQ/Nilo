import { RiText } from '@oxy.so/bloom/icons/RiText';
import { RiListOrdered } from '@oxy.so/bloom/icons/RiListOrdered';
import { RiImageLine } from '@oxy.so/bloom/icons/RiImageLine';
import { RiCodeBlock } from '@oxy.so/bloom/icons/RiCodeBlock';
import { RiDatabase2Line } from '@oxy.so/bloom/icons/RiDatabase2Line';
import { RiVideoLine } from '@oxy.so/bloom/icons/RiVideoLine';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useSlashItems } from '../slash-items';
import en from '@/lib/i18n/locales/en/editor.json';
import es from '@/lib/i18n/locales/es/editor.json';
let mockLocale: 'en' | 'es' = 'en';
const mockRead = (locale: 'en' | 'es', key: string) => {
  const catalog = (locale === 'en' ? en : es).slashMenu;
  const [, , name, field] = key.split('.');
  return (catalog as Record<string, Record<string, string>>)[name][field];
};
const mockTranslations = {
  en: (key: string) => mockRead('en', key),
  es: (key: string) => mockRead('es', key),
};
const mockT = (key: string) => mockTranslations[mockLocale](key);
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: mockTranslations[mockLocale], locale: mockLocale }),
}));
let items: ReturnType<typeof useSlashItems>;
let renderer: ReactTestRenderer;
function Hooks() {
  items = useSlashItems();
  return null;
}
afterEach(() => act(() => renderer.unmount()));
it.each(['en', 'es'] as const)(
  'offers the three toggle headings and linked database in %s',
  (locale) => {
    mockLocale = locale;
    act(() => {
      renderer = create(<Hooks />);
    });
    for (const level of [1, 2, 3]) {
      const item = items.find((entry) => entry.id === `toggleHeading${level}`);
      expect(item?.action).toEqual({
        kind: 'block',
        type: `heading_${level}`,
        props: { toggleable: true, expanded: true },
      });
      expect(item?.keywords?.length).toBeGreaterThan(1);
      expect(item?.label).toBe(mockT(`editor.slashMenu.toggleHeading${level}.label`));
    }
    expect(items.find((item) => item.id === 'linkedDatabase')?.action).toEqual({
      kind: 'custom',
      id: 'linkedDatabase',
    });
    // Notion's "Page": a subpage made here and shown as a block.
    const childPage = items.find((item) => item.id === 'childPage');
    expect(childPage?.action).toEqual({ kind: 'custom', id: 'childPage' });
    expect(childPage?.group).toBe('basic');
    expect(childPage?.label).toBe(mockT('editor.slashMenu.childPage.label'));
    expect(childPage?.keywords?.length).toBeGreaterThan(1);
    // Synced blocks: an original made here, and one pasted from elsewhere.
    for (const id of ['syncedBlock', 'pasteSyncedBlock']) {
      const item = items.find((entry) => entry.id === id);
      expect(item?.action).toEqual({ kind: 'custom', id });
      expect(item?.label).toBe(mockT(`editor.slashMenu.${id}.label`));
      expect(item?.keywords?.length).toBeGreaterThan(1);
    }
    const before = items;
    act(() => renderer.update(<Hooks />));
    expect(items).toBe(before);
  },
);

it('gives every command a shared icon without overriding its presentation', () => {
  mockLocale = 'en';
  act(() => {
    renderer = create(<Hooks />);
  });
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  expect(items).toHaveLength(36);
  for (const item of items) {
    expect(item.icon).toBeDefined();
    // Only a component reference: the shared slot owns its props and rendering.
    expect(item.leading).toBeUndefined();
    expect(item.label).toBe(mockT(`editor.slashMenu.${item.id}.label`));
    expect(item.description).toBe(mockT(`editor.slashMenu.${item.id}.description`));
    expect(item.keywords?.length).toBeGreaterThan(0);
  }
  for (const [id, Icon] of [
    ['paragraph', RiText],
    ['numberedList', RiListOrdered],
    ['image', RiImageLine],
    ['code', RiCodeBlock],
    ['youtube', RiVideoLine],
    ['inlineDatabase', RiDatabase2Line],
    ['linkedDatabase', RiDatabase2Line],
  ] as const) {
    expect(items.find((item) => item.id === id)?.icon).toBe(Icon);
  }
});

it('refreshes translated labels and search terms without changing icons or actions', () => {
  mockLocale = 'en';
  act(() => {
    renderer = create(<Hooks />);
  });
  const english = items;
  mockLocale = 'es';
  act(() => renderer.update(<Hooks />));
  expect(items).not.toBe(english);
  expect(items.map((item) => item.id)).toEqual(english.map((item) => item.id));
  for (const [index, item] of items.entries()) {
    const previous = english[index];
    expect(item.label).toBe(mockT(`editor.slashMenu.${item.id}.label`));
    expect(item.action).toEqual(previous.action);
    expect(item.group).toBe(previous.group);
    expect(item.icon).toBe(previous.icon);
  }
  expect(items.find((item) => item.id === 'paragraph')?.keywords).not.toEqual(
    english.find((item) => item.id === 'paragraph')?.keywords,
  );
});
