import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import RootLayout from '@/app/_layout';
import { BloomProvider } from '@oxy.so/bloom/provider';
import { OxyProvider } from '@oxy.so/services/ui/client';
import { useI18nStore } from '@/lib/stores/i18n-store';

jest.mock('@/global.css', () => ({}));
jest.mock('expo-linking', () => ({ createURL: () => 'nilo:///' }));
jest.mock('expo-router', () => ({ Stack: () => null }));
jest.mock('@oxy.so/services/ui/client', () => ({ OxyProvider: () => null }));
jest.mock('@oxy.so/bloom/provider', () => ({
  BloomProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@oxy.so/bloom/scroll/expo-router', () => ({ expoRouterScrollAdapter: undefined }));
jest.mock('@/lib/api/client', () => ({ setTokenGetter: jest.fn() }));
jest.mock('@/lib/account-boundary', () => ({ enterAccount: jest.fn(), sessionEnded: jest.fn() }));
jest.mock('@/lib/app-worker', () => ({ registerAppWorker: jest.fn() }));

it('keeps Bloom locale aligned with the persisted app locale and Oxy language changes', async () => {
  let renderer!: ReactTestRenderer;
  useI18nStore.getState().setLocale('en-US');
  await act(async () => {
    renderer = create(<RootLayout />);
  });
  expect(renderer.root.findByType(BloomProvider).props.locale).toBe('en-US');
  for (const locale of ['es-ES', 'es-MX', 'en-GB']) {
    await act(async () => renderer.root.findByType(OxyProvider).props.language.onChange(locale));
    expect(useI18nStore.getState().locale).toBe(locale);
    expect(renderer.root.findByType(BloomProvider).props.locale).toBe(locale);
  }
  act(() => renderer.unmount());
  useI18nStore.getState().setLocale('en-US');
});
