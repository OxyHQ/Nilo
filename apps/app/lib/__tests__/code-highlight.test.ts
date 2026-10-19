import type { CodeToken } from '@oxy.so/bloom/code';
import { CODE_LANGUAGES, codeLanguage, highlightCode } from '../code-highlight';

/** Every run of `kind`, across lines. */
const runs = (lines: CodeToken[][], kind: CodeToken['kind']) =>
  lines
    .flat()
    .filter((token) => token.kind === kind)
    .map((token) => token.text);
/** The text back, line by line. */
const text = (lines: CodeToken[][]) => lines.map((line) => line.map((t) => t.text).join(''));

describe('code languages', () => {
  it('reads aliases and fences as the language they name, anything else as plain', () => {
    expect(codeLanguage('ts')).toBe('typescript');
    expect(codeLanguage(' Python ')).toBe('python');
    expect(codeLanguage('sh')).toBe('bash');
    expect(codeLanguage('yml')).toBe('yaml');
    expect(codeLanguage('c++')).toBe('cpp');
    expect(codeLanguage('brainfuck')).toBe('plain');
    expect(codeLanguage(undefined)).toBe('plain');
  });

  it('gives back exactly the text it was given, in every language', () => {
    const source = 'a = "x" # y\n\n  <b c="d">e</b> -- f\n{"k": [1, true]}';
    for (const language of CODE_LANGUAGES) {
      expect(text(highlightCode(source, language))).toEqual(source.split('\n'));
    }
  });
});

describe('grammars', () => {
  it('colours JSON keys apart from string values', () => {
    const lines = highlightCode('{"name": "Nilo", "count": 3, "ok": true, "none": null}', 'json');
    expect(runs(lines, 'attrName')).toEqual(['"name"', '"count"', '"ok"', '"none"']);
    expect(runs(lines, 'string')).toEqual(['"Nilo"']);
    expect(runs(lines, 'constant')).toEqual(['3']);
    expect(runs(lines, 'keyword')).toEqual(['true', 'null']);
  });

  it('colours Python keywords, definitions, decorators, strings and comments', () => {
    const lines = highlightCode(
      '@cache\ndef total(items):\n    """Sum."""\n    return sum(items)  # all\nclass Cart(Base): pass',
      'python',
    );
    expect(runs(lines, 'keyword')).toEqual(['def', 'return', 'class', 'pass']);
    expect(runs(lines, 'function')).toEqual(['@cache', 'total', 'sum']);
    expect(runs(lines, 'string')).toEqual(['"""Sum."""']);
    expect(runs(lines, 'comment')).toEqual(['# all']);
    expect(runs(lines, 'className')).toEqual(['Cart', 'Base']);
  });

  it('colours Bash commands, flags, variables and comments, not a # inside a word', () => {
    const lines = highlightCode(
      '# build\nbun run build --filter api | tee "$LOG" # done\necho a#b',
      'bash',
    );
    expect(runs(lines, 'comment')).toEqual(['# build', '# done']);
    expect(runs(lines, 'function')).toEqual(['bun', 'tee', 'echo']);
    expect(runs(lines, 'attrName')).toEqual(['--filter']);
    expect(runs(lines, 'string')).toEqual(['"$LOG"']);
  });

  it('colours SQL keywords in any case, strings, functions and comments', () => {
    const lines = highlightCode(
      "SELECT count(*) FROM pages where title = 'It''s' -- open\n/* all */",
      'sql',
    );
    expect(runs(lines, 'keyword')).toEqual(['SELECT', 'FROM', 'where']);
    expect(runs(lines, 'function')).toEqual(['count']);
    expect(runs(lines, 'string')).toEqual(["'It''s'"]);
    expect(runs(lines, 'comment')).toEqual(['-- open', '/* all */']);
  });

  it('reads CSS selectors outside a rule and properties inside it', () => {
    const lines = highlightCode(
      '.card > h1 { color: #fff; margin: 0 4px; }\n@media print {}',
      'css',
    );
    expect(runs(lines, 'className')).toEqual(['.card', 'h1']);
    expect(runs(lines, 'attrName')).toEqual(['color', 'margin']);
    expect(runs(lines, 'constant')).toEqual(['#fff', '0', '4px']);
    expect(runs(lines, 'keyword')).toEqual(['@media']);
  });

  it('reads HTML tags, attributes, values, comments and entities', () => {
    const lines = highlightCode('<!-- nav --><a href="/x" hidden>Go &amp; see</a>', 'html');
    expect(runs(lines, 'comment')).toEqual(['<!-- nav -->']);
    expect(runs(lines, 'className')).toEqual(['a', 'a']);
    expect(runs(lines, 'attrName')).toEqual(['href', 'hidden']);
    expect(runs(lines, 'attrValue')).toEqual(['"/x"']);
    expect(runs(lines, 'constant')).toEqual(['&amp;']);
  });

  it('reads Markdown headings, markers, fences and inline marks', () => {
    const lines = highlightCode(
      '# Title\n- **bold** and `code`\n> [link](https://x.y)\n```\nraw *text*\n```',
      'markdown',
    );
    expect(runs(lines, 'keyword')).toEqual(['# Title', '**bold**']);
    expect(runs(lines, 'punctuation')).toEqual(['-', '>', '```', '```']);
    expect(runs(lines, 'constant')).toEqual(['`code`']);
    expect(runs(lines, 'attrValue')).toEqual(['[link](https://x.y)']);
    expect(runs(lines, 'string')).toEqual(['raw *text*']);
  });

  it('hands JavaScript and TypeScript to Bloom, and leaves the rest plain', () => {
    expect(runs(highlightCode('const a = 1;', 'typescript'), 'keyword')).toContain('const');
    expect(runs(highlightCode('fn main() {}', 'rust'), 'plain')).toEqual(['fn main() {}']);
  });
});
