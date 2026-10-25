import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CalendarSubscription } from '@oxy.so/nilo-contracts';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { CalendarsSection } from '../calendars-section';

const mockPush = jest.fn();
const mockClose = jest.fn();
const mockConfirm = jest.fn(async (_options: unknown) => true);
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('@oxy.so/bloom/toast', () => ({
  toast: {
    success: (message: string) => mockToast.success(message),
    error: (message: string) => mockToast.error(message),
  },
}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@oxy.so/bloom/surfaces', () => ({
  confirm: (options: unknown) => mockConfirm(options),
}));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ isAuthenticated: true }) }));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));
jest.mock('../settings-provider', () => ({ useNiloSettings: () => ({ close: mockClose }) }));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    locale: 'en-US',
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join('|')}` : key,
  }),
}));

const subscription = (over: Partial<CalendarSubscription> = {}): CalendarSubscription => ({
  id: 'cal-2',
  calendarId: 'cal-2',
  workspaceId: 'ws',
  name: 'Work',
  host: 'calendar.google.com',
  status: 'ok',
  lastError: null,
  lastHttpStatus: null,
  eventCount: 3,
  simplified: 0,
  timeZone: 'UTC',
  lastAttemptAt: '2026-11-01T10:00:00.000Z',
  lastSuccessAt: '2026-11-01T10:00:00.000Z',
  lastChangeAt: '2026-11-01T10:00:00.000Z',
  nextRefreshAt: '2026-11-01T10:30:00.000Z',
  createdAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

let renderer: ReactTestRenderer | undefined;
const mount = async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <BloomTestProviders>
          <CalendarsSection />
        </BloomTestProviders>
      </QueryClientProvider>,
    );
  });
  await settle();
};
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const root = () => (renderer as ReactTestRenderer).root;
const text = () => JSON.stringify(renderer?.toJSON());
const button = (label: string) => {
  const found = root().findAll(
    (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function',
  )[0];
  if (!found) throw new Error(`no button ${label}`);
  return found;
};
const input = (label: string) => {
  const found = root().findAll(
    (node) => node.props.label === label && typeof node.props.onChangeText === 'function',
  )[0];
  if (!found) throw new Error(`no input ${label}`);
  return found;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockResolvedValue({ data: { items: [subscription()], nextCursor: null } });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

it('lists each subscription with its host, events and when it was updated, never a URL', async () => {
  await mount();
  expect(mockGet).toHaveBeenCalledWith('/calendar/subscriptions', expect.anything());
  expect(text()).toContain('Work');
  expect(text()).toContain('calendar.google.com');
  expect(text()).toContain('settings.calendars.events:3');
  expect(text()).toContain('settings.calendars.status.ok');
});

it('says why a failing subscription could not update', async () => {
  mockGet.mockResolvedValue({
    data: {
      items: [subscription({ status: 'failing', lastError: 'http_error', lastHttpStatus: 404 })],
      nextCursor: null,
    },
  });
  await mount();
  expect(text()).toContain(
    'settings.calendars.status.failing:settings.calendars.errors.http_error',
  );
});

it('subscribes with the address, the name and the device zone, then clears the form', async () => {
  mockPost.mockResolvedValue({ data: subscription({ name: 'Family' }) });
  await mount();
  await act(async () => {
    input('settings.calendars.urlLabel').props.onChangeText(' webcal://p01.icloud.com/x ');
    input('settings.calendars.nameLabel').props.onChangeText('Family');
  });
  await act(async () => {
    button('settings.calendars.subscribe').props.onPress();
  });
  await settle();
  expect(mockPost).toHaveBeenCalledWith(
    '/calendar/subscriptions',
    expect.objectContaining({ url: 'webcal://p01.icloud.com/x', name: 'Family' }),
    expect.anything(),
  );
  expect(mockToast.success).toHaveBeenCalledWith('settings.calendars.subscribed:Family');
  expect(input('settings.calendars.urlLabel').props.value).toBe('');
});

it('shows what Nilo said when a subscription is refused', async () => {
  mockPost.mockRejectedValue(
    Object.assign(new Error('422'), {
      isAxiosError: true,
      response: { data: { error: { code: 'validation_failed', message: 'Only https' } } },
    }),
  );
  await mount();
  await act(async () => {
    input('settings.calendars.urlLabel').props.onChangeText('http://example.com/a.ics');
  });
  await act(async () => {
    button('settings.calendars.subscribe').props.onPress();
  });
  await settle();
  expect(mockToast.error).toHaveBeenCalledWith('Only https');
});

it('refreshes, opens and removes a subscription', async () => {
  mockPost.mockResolvedValue({ data: subscription() });
  mockDelete.mockResolvedValue({ status: 204 });
  await mount();
  await act(async () => {
    button('settings.calendars.refreshLabel:Work').props.onPress();
  });
  expect(mockPost).toHaveBeenCalledWith(
    '/calendar/subscriptions/cal-2/refresh',
    undefined,
    expect.anything(),
  );
  await act(async () => {
    button('settings.calendars.openLabel:Work').props.onPress();
  });
  expect(mockClose).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith('/db/cal-2');
  await act(async () => {
    button('settings.calendars.removeLabel:Work').props.onPress();
  });
  expect(mockConfirm).toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledWith('/calendar/subscriptions/cal-2');
});
