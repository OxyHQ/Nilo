import { Linking, TextInput } from 'react-native';
import { Calendar, RangeCalendar } from '@oxy.so/bloom/date-picker';
import { Switch } from '@oxy.so/bloom/switch';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { DatabaseCellScopeProvider } from '../cell-scope';
import { PropertyCell } from '../property-cell';
import { contactHref } from '../contact-cell';
import { useRowSearch } from '@/lib/hooks/use-database-rows';
import { useDatabasePeople } from '@/lib/hooks/use-database-people';
import type { DatabaseProperty, PropertyValue } from '@/lib/types/databases';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: true, oxyServices: {} }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({}),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en-US' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-member-profiles', () => ({
  useMemberProfiles: (ids: string[]) => ({
    data: ids
      .filter((id) => id !== 'gone')
      .map((id) => ({ id, name: { displayName: `Name of ${id}` } })),
  }),
  profileName: (profile?: { name?: { displayName?: string } }) =>
    profile?.name?.displayName ?? null,
}));
jest.mock('@/lib/hooks/use-database-people', () => ({ useDatabasePeople: jest.fn() }));
jest.mock('@/lib/hooks/use-database-rows', () => ({
  useRelatedRows: (_db: string, ids: string[]) => ({
    data: ids.map((id) => ({ id, title: `Row ${id}` })),
  }),
  useRowSearch: jest.fn(),
}));

let renderer: ReactTestRenderer;
beforeEach(() => jest.clearAllMocks());
afterEach(() => act(() => renderer?.unmount()));

function render(property: DatabaseProperty, value: PropertyValue, readOnly = false) {
  const onChange = jest.fn();
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <DatabaseCellScopeProvider databaseId="db">
          <PropertyCell
            property={property}
            value={value}
            onChange={onChange}
            readOnly={readOnly}
            variant="panel"
          />
        </DatabaseCellScopeProvider>
      </BloomTestProviders>,
    );
  });
  return onChange;
}
function pressable(label: string) {
  const found = renderer.root.findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];
  if (!found) throw new Error(`nothing pressable named ${label}`);
  return found;
}
function text() {
  return JSON.stringify(renderer.toJSON());
}

describe('person', () => {
  const property: DatabaseProperty = { id: 'who', name: 'Who', type: 'person' };

  it('shows people by name, never by id, created and edited by too', () => {
    render(property, { userIds: ['ana', 'gone'] });
    expect(text()).toContain('Name of ana');
    expect(text()).toContain('databases.people.unknown');
    expect(text()).not.toContain('"gone"');
    render({ id: 'by', name: 'Created by', type: 'created_by' }, { userIds: ['bo'] });
    expect(text()).toContain('Name of bo');
  });

  it('adds and removes the workspace’s members and guests', () => {
    jest.mocked(useDatabasePeople).mockReturnValue({
      data: [
        { userId: 'ana', guest: false, user: { name: { full: 'Ana' } } },
        { userId: 'gil', guest: true, user: { name: { full: 'Gil' } } },
      ],
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useDatabasePeople>);
    const onChange = render(property, { userIds: ['ana'] });
    act(() => pressable('Who').props.onPress());
    expect(useDatabasePeople).toHaveBeenCalledWith('db');
    expect(text()).toContain('databases.people.guest');
    act(() => pressable('Gil').props.onPress());
    expect(onChange).toHaveBeenLastCalledWith({ userIds: ['ana', 'gil'] });
    act(() => pressable('Ana').props.onPress());
    expect(onChange).toHaveBeenLastCalledWith({ userIds: [] });
  });
});

describe('relation', () => {
  const property: DatabaseProperty = {
    id: 'rel',
    name: 'Project',
    type: 'relation',
    config: { targetDatabaseId: 'projects' },
  };

  it('searches the related database’s rows to add one, removes and opens one', () => {
    jest.mocked(useRowSearch).mockImplementation(
      (_db, query) =>
        ({
          data: [{ id: 'b', title: query ? `Found ${query}` : 'Beta' }],
          isPending: false,
          isError: false,
        }) as unknown as ReturnType<typeof useRowSearch>,
    );
    const onChange = render(property, { pageIds: ['a'] });
    act(() => pressable('Project').props.onPress());
    expect(useRowSearch).toHaveBeenLastCalledWith('projects', '');
    const field = renderer.root.findAll(
      (node) =>
        node.props.label === 'databases.filters.searchRows' &&
        typeof node.props.onChangeText === 'function',
    )[0];
    act(() => field?.props.onChangeText('lau'));
    expect(useRowSearch).toHaveBeenLastCalledWith('projects', 'lau');
    act(() => pressable('Found lau').props.onPress());
    expect(onChange).toHaveBeenLastCalledWith({ pageIds: ['a', 'b'] });
    act(() => pressable('databases.relations.remove').props.onPress());
    expect(onChange).toHaveBeenLastCalledWith({ pageIds: [] });
    act(() => pressable('databases.relations.open').props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/p/[pageId]', params: { pageId: 'a' } });
  });
});

describe('date', () => {
  const property: DatabaseProperty = { id: 'due', name: 'Due', type: 'date' };
  const local = (d: number, h = 0, m = 0) => new Date(2026, 9, d, h, m).toISOString();

  it('picks another day keeping the time and the end, on native too', () => {
    const value = { start: local(1, 9, 30), end: local(3, 18), includeTime: true };
    const onChange = render(property, value);
    act(() => pressable('Due: Oct 1, 2026 09:30 → Oct 3, 2026 18:00').props.onPress());
    // An end: the days are picked as a range.
    const range = renderer.root.findByType(RangeCalendar);
    act(() => range.props.onChange({ start: new Date(2026, 9, 5), end: new Date(2026, 9, 8) }));
    expect(onChange).toHaveBeenLastCalledWith({
      start: local(5, 9, 30),
      end: local(8, 18),
      includeTime: true,
    });
    const startTime = renderer.root.findAll(
      (node) =>
        node.props.accessibilityLabel === 'databases.dates.startTime' &&
        typeof node.props.onChange === 'function',
    )[0];
    expect(startTime?.props.value).toBe('09:30');
    act(() => startTime?.props.onChange('11:00'));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, start: local(1, 11) });
  });

  it('adds an end date and a time, and clears the date', () => {
    const value = { start: '2026-10-05T00:00:00.000Z', end: null, includeTime: false };
    const onChange = render(property, value);
    act(() => pressable('Due: Oct 5, 2026').props.onPress());
    expect(renderer.root.findAllByType(Calendar)).toHaveLength(1);
    const [endSwitch, timeSwitch] = renderer.root.findAllByType(Switch);
    act(() => endSwitch?.props.onCheckedChange(true));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, end: value.start });
    expect(renderer.root.findAllByType(RangeCalendar)).toHaveLength(1);
    act(() => timeSwitch?.props.onCheckedChange(true));
    expect(onChange).toHaveBeenLastCalledWith({
      start: local(5),
      end: null,
      includeTime: true,
    });
    const clear = renderer.root.findAll(
      (node) => node.props.children === 'databases.actions.clear' && node.props.onPress,
    )[0];
    act(() => clear?.props.onPress());
    expect(onChange).toHaveBeenLastCalledWith({ start: null, end: null, includeTime: false });
  });
});

describe('url, email and phone', () => {
  it('open their link when not edited, and edit with the keyboard of their kind', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const onChange = render({ id: 'mail', name: 'Mail', type: 'email' }, { value: 'a@b.test' });
    act(() => pressable('a@b.test').props.onPress({ stopPropagation: jest.fn() }));
    expect(open).toHaveBeenCalledWith('mailto:a@b.test');
    act(() => pressable('databases.contact.edit').props.onPress());
    const input = renderer.root.findByType(TextInput);
    expect(input.props.keyboardType).toBe('email-address');
    expect(input.props.autoCapitalize).toBe('none');
    act(() => input.props.onChangeText(' c@d.test '));
    act(() => input.props.onBlur());
    expect(onChange).toHaveBeenCalledWith({ value: 'c@d.test' });

    render({ id: 'tel', name: 'Phone', type: 'phone' }, { value: '' });
    expect(renderer.root.findByType(TextInput).props.keyboardType).toBe('phone-pad');
    render({ id: 'n', name: 'Number', type: 'number' }, { number: 1 });
    // iOS's number pads have no minus sign.
    expect(renderer.root.findByType(TextInput).props.keyboardType).toBe('numbers-and-punctuation');
  });

  it('read as links that open, read-only too', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    render({ id: 'tel', name: 'Phone', type: 'phone' }, { value: '+34 600 11 22 33' }, true);
    act(() => pressable('+34 600 11 22 33').props.onPress({ stopPropagation: jest.fn() }));
    expect(open).toHaveBeenCalledWith('tel:+34600112233');
    expect(contactHref('url', 'example.test/a')).toBe('https://example.test/a');
    expect(contactHref('url', 'http://example.test')).toBe('http://example.test');
    expect(contactHref('email', ' ')).toBeNull();
  });
});
