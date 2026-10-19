import { markdownToBlocks } from '@oxy.so/nilo-contracts';
import { SELECT_COLORS } from '@/lib/types/databases';
import { BUILT_IN_TEMPLATES, templateLocale } from '../templates/built-in';

describe('Nilo’s templates', () => {
  it('are written in every language the app speaks, with distinct keys', () => {
    expect(new Set(BUILT_IN_TEMPLATES.map((t) => t.key)).size).toBe(BUILT_IN_TEMPLATES.length);
    for (const template of BUILT_IN_TEMPLATES) {
      for (const locale of ['en', 'es'] as const) {
        expect(template.words[locale].title.trim()).not.toBe('');
        expect(template.words[locale].description.trim()).not.toBe('');
      }
    }
  });

  it('make blocks from their Markdown, and databases the server accepts', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      for (const locale of ['en', 'es'] as const) {
        if (template.kind === 'page') {
          expect(markdownToBlocks(template.words[locale].markdown).length).toBeGreaterThan(2);
          continue;
        }
        const { properties } = template.words[locale].schema;
        expect(properties.find((p) => p.id === 'name')?.type).toBe('text');
        for (const p of properties) {
          for (const option of p.config?.options ?? [])
            expect(SELECT_COLORS).toContain(option.color);
        }
        if (template.board) {
          expect(properties.map((p) => p.id)).toContain(template.board.groupBy);
        }
      }
    }
  });

  it('read Spanish for any Spanish, English otherwise', () => {
    expect(templateLocale('es-MX')).toBe('es');
    expect(templateLocale('es')).toBe('es');
    expect(templateLocale('fr')).toBe('en');
  });
});
