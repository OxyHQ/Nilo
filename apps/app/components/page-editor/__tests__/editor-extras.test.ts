jest.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@oxy.so/services/ui/client', () => ({ useOxy: () => ({ oxyServices: {} }) }));
jest.mock('@/lib/api/client', () => ({ __esModule: true, default: { post: jest.fn() } }));
import { blockLink } from '../editor-extras';
import { CODE_LANGUAGES, highlightCode } from '@/lib/code-highlight';

describe('what Nilo hands the editor', () => {
  it('links to one block of a page, which the page opens scrolled to', () => {
    expect(blockLink('page-1', 'block 2')).toBe('https://nilo.so/p/page-1?blockId=block%202');
  });

  it('highlights code into lines whose runs spell the code exactly', () => {
    const code = 'SELECT 1\nFROM t';
    const lines = highlightCode(code, 'sql');
    expect(lines.map((line) => line.map((token) => token.text).join('')).join('\n')).toBe(code);
    expect(CODE_LANGUAGES).toContain('plain');
  });
});
