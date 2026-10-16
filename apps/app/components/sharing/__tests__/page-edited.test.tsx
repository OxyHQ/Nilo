import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { RiPencilLine } from '@oxy.so/bloom/icons/RiPencilLine';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import NotificationsScreen from '@/app/(app)/notifications';
import { usePage } from '@/lib/hooks/use-pages';

const mockPush = jest.fn();
const mockMarkRead = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('@oxy.so/services', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => ({ status: 'granted' }),
}));
jest.mock('@/components/reminders/reminder-list', () => ({ ReminderList: () => null }));
jest.mock('@/components/sharing/page-shared-notification', () => ({
  PageSharedNotification: () => null,
}));
jest.mock('@/lib/hooks/use-pages', () => ({
  usePage: jest.fn(() => ({ data: { page: { title: 'Roadmap' } } })),
}));
jest.mock('@/lib/hooks/use-notifications', () => ({
  useNotifications: () => ({
    data: {
      notifications: [
        {
          id: 'notice',
          type: 'page_edited',
          status: 'sent',
          priority: 'low',
          data: { pageId: 'page', authorId: 'author' },
          createdAt: new Date().toISOString(),
          body: '',
        },
      ],
      unreadCount: 1,
    },
  }),
  useMarkAsRead: () => ({ mutate: mockMarkRead }),
  useMarkAllAsRead: () => ({ mutate: jest.fn() }),
  useDismissNotification: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { page: string }) =>
      key === 'notifications.pageEdited' ? `${params?.page} was edited` : key,
  }),
}));
let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));
it('renders the edit icon and translated page title, opens the page, and marks the notice read', async () => {
  await act(async () => {
    renderer = create(
      <BloomTestProviders>
        <NotificationsScreen />
      </BloomTestProviders>,
    );
  });
  expect(renderer.root.findAllByType(RiPencilLine)).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).toContain('Roadmap was edited');
  expect(usePage).toHaveBeenCalledWith('page');
  act(() =>
    renderer.root
      .find((node) => node.props.accessibilityLabel === 'notifications.open' && node.props.onPress)
      .props.onPress(),
  );
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/p/[pageId]', params: { pageId: 'page' } });
  expect(mockMarkRead).toHaveBeenCalledWith('notice');
});
