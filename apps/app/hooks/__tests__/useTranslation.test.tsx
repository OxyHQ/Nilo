import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useTranslation } from '../useTranslation';

let mockLocale = 'en';
jest.mock('@/lib/stores/i18n-store', () => ({
  useI18nStore: (select: (state: unknown) => unknown) =>
    select({ locale: mockLocale, setLocale: jest.fn() }),
}));
let translated: ReturnType<typeof useTranslation>;
function Consumer() {
  translated = useTranslation();
  return null;
}
it('keeps the editor translation dependency stable until the language changes', () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Consumer />);
  });
  const first = translated.t;
  act(() => renderer.update(<Consumer />));
  expect(translated.t).toBe(first);
  expect(translated.t('databases.views.form')).toBe('Form');
  mockLocale = 'es';
  act(() => renderer.update(<Consumer />));
  expect(translated.t).not.toBe(first);
  expect(translated.t('databases.views.form')).toBe('Formulario');
  act(() => renderer.unmount());
});
