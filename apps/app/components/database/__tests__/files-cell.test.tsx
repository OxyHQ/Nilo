import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BloomTestProviders } from '@/test-support/bloom-providers';
import { PropertyCell } from '../property-cell';

jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));
jest.mock('@/lib/useColorScheme', () => ({ useColorScheme: () => ({ colors: {} }) }));
jest.mock('@/lib/hooks/use-database-rows', () => ({ useRelatedRows: () => ({}) }));

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

it('shows files kept in Oxy storage, which have no link, beside linked ones', () => {
  act(() => {
    renderer = create(
      <BloomTestProviders>
        <PropertyCell
          readOnly
          property={{ id: 'files', name: 'Files', type: 'files' }}
          value={{
            files: [
              { name: 'scan.pdf', fileId: 'file-1' },
              { name: 'same.png', url: 'https://example.test/a.png' },
              { name: 'again.png', url: 'https://example.test/a.png' },
            ],
          }}
          onChange={jest.fn()}
        />
      </BloomTestProviders>,
    );
  });
  const text = JSON.stringify(renderer.toJSON());
  for (const name of ['scan.pdf', 'same.png', 'again.png']) expect(text).toContain(name);
});
