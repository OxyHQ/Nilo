import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PublicFormRoute from '@/app/form/[token]';
import apiClient from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openAccountDialog } from '@oxy.so/services';

jest.mock('@oxy.so/services', () => ({
  useOxy: () => ({ isAuthenticated: false, user: null }),
  openAccountDialog: jest.fn(),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ token: 'token' }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/lib/api/client', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));
const descriptor = {
  title: 'Responses',
  description: 'Tell us more',
  requireSignIn: false,
  fields: [{ id: 'name', name: 'Name', type: 'text', required: true }],
};
let client: QueryClient;
let renderer: ReactTestRenderer;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <PublicFormRoute />
      </QueryClientProvider>,
    );
  });
  await settle();
}
function button(label: string) {
  return renderer.root
    .findAllByType(Button)
    .find((node) => node.props.accessibilityLabel === label);
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity, retry: false },
      mutations: { gcTime: Infinity, retry: false },
    },
  });
  jest.mocked(apiClient.get).mockResolvedValue({ data: descriptor });
  jest.mocked(apiClient.post).mockResolvedValue({ data: { ok: true } });
});
afterEach(() => {
  act(() => renderer?.unmount());
  client.clear();
});

it('validates the Name before posting and resets all answers after thanks', async () => {
  await mount();
  act(() => button('databases.form.submit')?.props.onPress());
  expect(apiClient.post).not.toHaveBeenCalled();
  expect(JSON.stringify(renderer.toJSON())).toContain('databases.form.required');
  act(() => renderer.root.findByType(Input).props.onChangeText('Alice'));
  await act(async () => button('databases.form.submit')?.props.onPress());
  await settle();
  expect(apiClient.post).toHaveBeenCalledWith('/forms/token', {
    values: { name: { text: 'Alice' } },
  });
  expect(JSON.stringify(renderer.toJSON())).toContain('databases.form.thanks');
  act(() => button('databases.form.another')?.props.onPress());
  await settle();
  expect(renderer.root.findByType(Input).props.value).toBe('');
});
it('shows a closed form without accepting a response', async () => {
  jest.mocked(apiClient.get).mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
  await mount();
  expect(JSON.stringify(renderer.toJSON())).toContain('databases.form.unavailable');
  expect(button('databases.form.submit')).toBeUndefined();
});
it('offers sign-in without navigating away from the form', async () => {
  jest.mocked(apiClient.get).mockRejectedValue({
    isAxiosError: true,
    response: { status: 401, data: { code: 'SIGN_IN_REQUIRED' } },
  });
  await mount();
  act(() => button('login.signInButton')?.props.onPress());
  expect(openAccountDialog).toHaveBeenCalledTimes(1);
  expect(button('databases.form.submit')).toBeUndefined();
});
it('retains answers and disables submission during Retry-After', async () => {
  jest.mocked(apiClient.post).mockRejectedValue({
    isAxiosError: true,
    response: { status: 429, headers: { 'retry-after': '60' } },
  });
  await mount();
  act(() => renderer.root.findByType(Input).props.onChangeText('Alice'));
  await act(async () => button('databases.form.submit')?.props.onPress());
  await settle();
  expect(button('databases.form.submit')?.props.disabled).toBe(true);
  expect(renderer.root.findByType(Input).props.value).toBe('Alice');
  expect(JSON.stringify(renderer.toJSON())).toContain('databases.form.rateLimited');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});
