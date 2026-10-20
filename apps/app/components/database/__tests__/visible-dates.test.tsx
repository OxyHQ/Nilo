import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { useVisibleDatesStore } from '@/lib/stores/visible-dates-store';
import { ViewCalendar } from '../view-calendar';
import { ViewTimeline } from '../view-timeline';
import type { Database, DatabaseView, Filter, FilterGroup } from '@/lib/types/databases';

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: false, oxyServices: {} }),
}));
// A view's groups are saved with it (collapsed, moved, hidden).
jest.mock('@/lib/hooks/use-database-views', () => ({
  useUpdateView: () => ({ mutate: jest.fn(), isPending: false }),
}));

const database = {
  id: 'db',
  schema: {
    properties: [
      { id: 'name', name: 'Name', type: 'text' },
      { id: 'start', name: 'Start', type: 'date' },
      { id: 'end', name: 'End', type: 'date' },
    ],
  },
} as Database;

let renderer: ReactTestRenderer;
const originalOS = Platform.OS;
beforeEach(() => {
  Platform.OS = 'web';
  useVisibleDatesStore.setState({ byView: {} });
  jest.useFakeTimers({ now: new Date(2026, 9, 19, 12) });
});
afterEach(() => {
  act(() => renderer?.unmount());
  Platform.OS = originalOS;
  jest.useRealTimers();
});

const shown = () => useVisibleDatesStore.getState().byView.view as FilterGroup;
/** Each condition as `property operator day`, the day being the UTC date of its bound. */
function conditions(filter: Filter): string[] {
  if (filter.kind === 'group') return filter.filters.flatMap(conditions);
  return [`${filter.propertyId} ${filter.operator} ${String(filter.value).slice(0, 10)}`];
}

it('a calendar reads the six weeks of its month, and the next month when moved to it', () => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <ViewCalendar
          database={database}
          view={{ id: 'view', config: { datePropertyId: 'start' } } as DatabaseView}
          rows={[]}
          isLoading={false}
        />
      </BloomTestProviders>,
    );
  });
  // October 2026's grid runs from Sunday 27 September to Saturday 7 November.
  const october = conditions(shown());
  expect(october).toHaveLength(2);
  expect(october.every((c) => c.startsWith('start '))).toBe(true);
  const [before, after] = october;
  expect(before).toMatch(/^start before 2026-11-0[89]$/);
  expect(after).toMatch(/^start on_or_after 2026-09-2[56]$/);

  const next = renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === 'databases.calendar.nextMonth' && node.props.onPress,
  )[0];
  act(() => next?.props.onPress());
  // November's grid runs from Sunday 1 November to Saturday 12 December.
  expect(conditions(shown())[0]).toMatch(/^start before 2026-12-1[34]$/);
});

it('a timeline reads the rows whose span meets its window', () => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <ViewTimeline
          database={database}
          view={
            {
              id: 'view',
              config: { startPropertyId: 'start', endPropertyId: 'end' },
            } as DatabaseView
          }
          rows={[]}
          isLoading={false}
        />
      </BloomTestProviders>,
    );
  });
  const filter = shown();
  expect(filter.combinator).toBe('and');
  const [startsBefore, meets] = filter.filters;
  // A week back from 19 October, sixty days: 12 October to 11 December.
  expect(conditions(startsBefore as Filter)[0]).toMatch(/^start before 2026-12-1[23]$/);
  // Starting in the window, or starting before it and ending in it or after.
  expect(meets).toMatchObject({ kind: 'group', combinator: 'or' });
  expect(conditions(meets as Filter).map((c) => c.split(' ').slice(0, 2).join(' '))).toEqual([
    'start on_or_after',
    'end on_or_after',
  ]);
});
