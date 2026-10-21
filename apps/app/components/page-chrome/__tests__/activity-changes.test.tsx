import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PageActivityChange } from '@oxy.so/nilo-contracts';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import apiClient from '@/lib/api/client';
import { queryKeys } from '@/lib/hooks/query-keys';
import { PropertyCell } from '../../database/property-cell';
import { ActivityChanges } from '../activity-changes';
import { IconDisplay } from '../icon-display';

// Keep the actual shared value renderers. No transport is needed to display
// historical scalar/schema snapshots or opaque changes.
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
jest.mock('@/lib/config', () => ({
  __esModule: true,
  default: { apiUrl: 'https://api.example.test' },
}));
jest.mock('@oxy.so/services/ui/client', () => ({
  useOxy: () => ({ isAuthenticated: true, oxyServices: {} }),
}));
jest.mock('@/lib/realtime/use-live-updates', () => ({ useWorkspaceLive: jest.fn() }));

let client: QueryClient;
let renderer: ReactTestRenderer;
function text(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : text(child))).join(' ');
}
const valueText = (side: 'before' | 'after') =>
  text(renderer.root.findAllByProps({ accessibilityLabel: `pages.activity.${side}` })[0]);
async function mount(changes: PageActivityChange[]) {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <QueryClientProvider client={client}>
          <ActivityChanges changes={changes} pageId="row" />
        </QueryClientProvider>
      </BloomTestProviders>,
    );
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
  expect(apiClient.get).not.toHaveBeenCalled();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('renders before and after using historical option labels even when cached live schema has changed type', async () => {
  client.setQueryData(queryKeys.databases.detail('db'), {
    database: {
      id: 'db',
      schema: {
        properties: [
          {
            id: 'status',
            name: 'Renamed live field',
            type: 'number',
            config: { format: 'percent' },
          },
        ],
      },
    },
  });
  await mount([
    {
      field: 'properties',
      propertyId: 'status',
      property: {
        name: 'Historical status',
        type: 'select',
        config: {
          options: [
            { id: 'todo', name: 'Historical to do', color: 'gray' },
            { id: 'done', name: 'Historical done', color: 'green' },
          ],
        },
      },
      before: { optionId: 'todo' },
      after: { optionId: 'done' },
    },
  ]);
  expect(text(renderer.root)).toContain('Historical status');
  expect(valueText('before')).toBe('Historical to do');
  expect(valueText('after')).toBe('Historical done');
  expect(text(renderer.root)).not.toContain('Renamed live field');
  const cells = renderer.root.findAllByType(PropertyCell);
  expect(cells).toHaveLength(2);
  expect(cells.every((cell) => cell.props.readOnly && cell.props.property.type === 'select')).toBe(
    true,
  );
});

it('does not treat numeric zero or boolean false as an empty metadata value', async () => {
  await mount([{ field: 'coverPosition', before: 0, after: 50 }]);
  expect(valueText('before')).toBe('0');
  expect(valueText('after')).toBe('50');
  act(() => renderer.unmount());
  await mount([{ field: 'locked', before: false, after: true }]);
  expect(valueText('before')).toBe('pages.activity.disabled');
  expect(valueText('after')).toBe('pages.activity.enabled');
  expect(text(renderer.root)).not.toContain('pages.activity.emptyValue');
});

it('retains zero and unchecked values inside typed property renderers', async () => {
  await mount([
    {
      field: 'properties',
      propertyId: 'amount',
      property: { name: 'Amount', type: 'number' },
      before: { number: 0 },
      after: { number: 12 },
    },
  ]);
  expect(valueText('before')).toBe('0');
  expect(valueText('after')).toBe('12');
  act(() => renderer.unmount());
  await mount([
    {
      field: 'properties',
      propertyId: 'checked',
      property: { name: 'Approved', type: 'checkbox' },
      before: { checked: false },
      after: { checked: true },
    },
  ]);
  expect(valueText('before')).toBe('sharing.unchecked');
  expect(valueText('after')).toBe('sharing.checked');
});

it.each([null, undefined, ''])(
  'labels an empty %s value without losing the nonempty after value',
  async (before) => {
    await mount([{ field: 'title', before, after: 'Named page' }]);
    expect(valueText('before')).toBe('pages.activity.emptyValue');
    expect(valueText('after')).toBe('Named page');
  },
);

it('keeps schema-less property values generic instead of exposing raw IDs or inventing their type', async () => {
  await mount([
    {
      field: 'properties',
      propertyId: 'hidden-property',
      before: { optionId: 'private-before' },
      after: { optionId: 'private-after' },
    },
  ]);
  expect(text(renderer.root)).toContain('pages.activity.fields.properties');
  expect(text(renderer.root)).toContain('pages.activity.changedValue');
  expect(text(renderer.root)).not.toMatch(/hidden-property|private-before|private-after/);
  expect(renderer.root.findAllByType(PropertyCell)).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({ accessibilityLabel: 'pages.activity.before' }),
  ).toHaveLength(0);
});

it('keeps historical relations and opaque location/media changes generic, without loading guessed targets', async () => {
  await mount([
    {
      field: 'properties',
      propertyId: 'related',
      property: { name: 'Historical relation', type: 'relation' },
      before: { pageIds: ['secret-row-before'] },
      after: { pageIds: ['secret-row-after'] },
    },
    { field: 'parentId', before: 'secret-parent-before', after: 'secret-parent-after' },
    { field: 'teamspaceId', before: 'secret-team-before', after: 'secret-team-after' },
    {
      field: 'cover',
      before: 'https://private.example.test/before',
      after: 'https://private.example.test/after',
    },
  ]);
  const displayed = text(renderer.root);
  expect(displayed).toContain('Historical relation');
  expect(displayed.match(/pages.activity.changedValue/g)).toHaveLength(4);
  expect(displayed).not.toMatch(/secret-|private\.example|common.loading/);
  expect(renderer.root.findAllByType(PropertyCell)).toHaveLength(0);
  expect(renderer.root.findAllByType(IconDisplay)).toHaveLength(0);
});

it('delegates old and new page icons to the actual page icon renderer', async () => {
  await mount([{ field: 'icon', before: '📄', after: '📚' }]);
  expect(valueText('before')).toBe('📄');
  expect(valueText('after')).toBe('📚');
  const icons = renderer.root.findAllByType(IconDisplay);
  expect(icons.map((icon) => icon.props.value)).toEqual(['📄', '📚']);
  expect(icons.every((icon) => icon.props.pageId === 'row')).toBe(true);
});
