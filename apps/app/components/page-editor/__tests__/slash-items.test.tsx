import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useSlashItems } from '../slash-items';
import en from '@/lib/i18n/locales/en/editor.json';
import es from '@/lib/i18n/locales/es/editor.json';
let mockLocale: 'en' | 'es' = 'en';
const mockT = (key: string) => {
  const catalog = (mockLocale === 'en' ? en : es).slashMenu;
  const [, , name, field] = key.split('.');
  return (catalog as Record<string, Record<string, string>>)[name][field];
};
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: mockT, locale: mockLocale }),
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
    const before = items;
    act(() => renderer.update(<Hooks />));
    expect(items).toBe(before);
  },
);
