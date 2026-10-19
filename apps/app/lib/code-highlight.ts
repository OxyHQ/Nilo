/**
 * Syntax highlighting for code blocks, drawn natively (no web view): source
 * text in, lines of classified runs out, in the token kinds Bloom's code
 * palette colours (`@oxy.so/bloom/code`). JavaScript and TypeScript use
 * Bloom's own tokenizer; JSON, Python, Bash, SQL, CSS, HTML and Markdown have
 * small grammars here. Any other language is plain text: a grammar that
 * half-understands a language paints valid code as broken.
 */
import { type CodeToken, type CodeTokenKind, tokenizeCode } from '@oxy.so/bloom/code';

/** The languages a code block offers, in the order its picker lists them. */
export const CODE_LANGUAGES = [
  'plain',
  'javascript',
  'typescript',
  'json',
  'python',
  'bash',
  'sql',
  'css',
  'html',
  'markdown',
  'yaml',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'swift',
  'kotlin',
] as const;

export type CodeLanguageId = (typeof CODE_LANGUAGES)[number];

/** What each language is called in its picker; the same in every language. */
export const CODE_LANGUAGE_NAMES: Record<Exclude<CodeLanguageId, 'plain'>, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  json: 'JSON',
  python: 'Python',
  bash: 'Bash',
  sql: 'SQL',
  css: 'CSS',
  html: 'HTML',
  markdown: 'Markdown',
  yaml: 'YAML',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  swift: 'Swift',
  kotlin: 'Kotlin',
};

const ALIASES: Record<string, CodeLanguageId> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  xml: 'html',
  svg: 'html',
  md: 'markdown',
  yml: 'yaml',
  golang: 'go',
  rs: 'rust',
  'c++': 'cpp',
  cs: 'csharp',
  'c#': 'csharp',
  rb: 'ruby',
  kt: 'kotlin',
  text: 'plain',
  plaintext: 'plain',
  txt: 'plain',
};

/** A stored language (`content.language`, or a fence's info string) as one the picker knows. */
export function codeLanguage(value: unknown): CodeLanguageId {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if ((CODE_LANGUAGES as readonly string[]).includes(raw)) return raw as CodeLanguageId;
  return ALIASES[raw] ?? 'plain';
}

// ─────────────────────────────── the engine ───────────────────────────────

type Classify =
  | CodeTokenKind
  | ((match: RegExpExecArray, before: readonly CodeToken[]) => CodeTokenKind);
type Rule = readonly [RegExp, Classify];

/** Runs of `source`, each rule tried in order at every position (rules are sticky). */
function scan(source: string, rules: readonly Rule[]): CodeToken[] {
  const tokens: CodeToken[] = [];
  const push = (kind: CodeTokenKind, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind && kind === 'plain') last.text += text;
    else tokens.push({ kind, text });
  };
  let at = 0;
  outer: while (at < source.length) {
    for (const [pattern, classify] of rules) {
      pattern.lastIndex = at;
      const match = pattern.exec(source);
      if (match && match[0].length > 0) {
        push(typeof classify === 'function' ? classify(match, tokens) : classify, match[0]);
        at += match[0].length;
        continue outer;
      }
    }
    push('plain', source[at] as string);
    at += 1;
  }
  return tokens;
}

/** Tokens split at line breaks: one array of runs per line. */
function toLines(tokens: readonly CodeToken[]): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1]?.push({ kind: token.kind, text: part });
    });
  }
  return lines;
}

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean));
const lastSignificant = (before: readonly CodeToken[]) => {
  for (let i = before.length - 1; i >= 0; i--) {
    const token = before[i];
    if (token?.text.trim()) return token;
  }
  return undefined;
};

const NUMBER: Rule = [/-?\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/iy, 'constant'];
const WHITESPACE: Rule = [/\s+/y, 'plain'];

// ─────────────────────────────── grammars ───────────────────────────────

const JSON_RULES: readonly Rule[] = [
  WHITESPACE,
  [/"(?:\\.|[^"\\\n])*"(?=\s*:)/y, 'attrName'],
  [/"(?:\\.|[^"\\\n])*"/y, 'string'],
  NUMBER,
  [/\b(?:true|false|null)\b/y, 'keyword'],
  [/[{}[\],:]/y, 'punctuation'],
];

const PYTHON_KEYWORDS = words(`and as assert async await break class continue def del elif else
  except False finally for from global if import in is lambda None nonlocal not or pass raise
  return True try while with yield match case self`);
const PYTHON_RULES: readonly Rule[] = [
  WHITESPACE,
  [/#[^\n]*/y, 'comment'],
  [/[rbfu]{0,2}("""[\s\S]*?"""|'''[\s\S]*?''')/iy, 'string'],
  [/[rbfu]{0,2}("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/iy, 'string'],
  [/@[\w.]+/y, 'function'],
  NUMBER,
  [
    /[A-Za-z_]\w*/y,
    (match, before) => {
      const word = match[0];
      const previous = lastSignificant(before)?.text;
      if (PYTHON_KEYWORDS.has(word)) return 'keyword';
      if (previous === 'def') return 'function';
      if (previous === 'class') return 'className';
      if (/^[A-Z][A-Z0-9_]+$/.test(word)) return 'constant';
      if (/^[A-Z]/.test(word)) return 'className';
      const rest = match.input.slice(match.index + word.length);
      return /^\s*\(/.test(rest) ? 'function' : 'plain';
    },
  ],
  [/[-+*/%=<>!&|^~]=?|\*\*|\/\/|->/y, 'operator'],
  [/[()[\]{}.,:;]/y, 'punctuation'],
];

const BASH_KEYWORDS = words(`if then else elif fi for while until do done case esac in function
  return export local readonly select time break continue`);
const BASH_RULES: readonly Rule[] = [
  [/[ \t]+/y, 'plain'],
  [/\n/y, 'plain'],
  [/(?:^|(?<=\s))#[^\n]*/my, 'comment'],
  [/'[^']*'/y, 'string'],
  [/"(?:\\.|[^"\\])*"/y, 'string'],
  [/\$(?:\{[^}\n]*\}|\(|[A-Za-z_]\w*|[0-9@#?$!*-])/y, 'constant'],
  [/(?<=\s|^)--?[A-Za-z][\w-]*/my, 'attrName'],
  [
    /[A-Za-z_][\w.-]*/y,
    (match, before) => {
      const word = match[0];
      if (BASH_KEYWORDS.has(word)) return 'keyword';
      // The first word of a command: after a line start, a pipe, `;` or `&&`.
      const previous = lastSignificant(before);
      const lineStart = /(^|\n)[ \t]*$/.test(match.input.slice(0, match.index));
      if (lineStart || (previous && /^(\||;|&&|\|\||then|do|else)$/.test(previous.text)))
        return 'function';
      return 'plain';
    },
  ],
  NUMBER,
  [/&&|\|\||[|;&<>]=?|=/y, 'operator'],
  [/[()[\]{}]/y, 'punctuation'],
];

const SQL_KEYWORDS = words(`select from where and or not insert into values update set delete
  create table alter drop index view join left right inner outer full cross on as group by order
  having limit offset union all distinct case when then else end is null like ilike in between
  exists primary key foreign references default unique check constraint returning with recursive
  asc desc true false begin commit rollback transaction grant revoke if cascade using natural
  over partition window lateral integer int bigint smallint text varchar char boolean bool date
  timestamp timestamptz numeric decimal real double precision serial jsonb json uuid`);
const SQL_RULES: readonly Rule[] = [
  WHITESPACE,
  [/--[^\n]*/y, 'comment'],
  [/\/\*[\s\S]*?\*\//y, 'comment'],
  [/'(?:''|[^'])*'/y, 'string'],
  [/"(?:""|[^"])*"/y, 'attrName'],
  NUMBER,
  [
    /[A-Za-z_]\w*/y,
    (match) => {
      const word = match[0];
      if (SQL_KEYWORDS.has(word.toLowerCase())) return 'keyword';
      const rest = match.input.slice(match.index + word.length);
      return /^\s*\(/.test(rest) ? 'function' : 'plain';
    },
  ],
  [/[<>!=]=?|<>|\|\||::|[-+*/%]/y, 'operator'],
  [/[(),;.]/y, 'punctuation'],
];

/** CSS reads differently inside a rule's braces (properties) than outside (selectors). */
function scanCss(source: string): CodeToken[] {
  let depth = 0;
  // An at-rule's prelude (`@media print`) is a condition, not a selector.
  let prelude = false;
  const rules: readonly Rule[] = [
    WHITESPACE,
    [/\/\*[\s\S]*?\*\//y, 'comment'],
    [/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/y, 'string'],
    [
      /@[\w-]+/y,
      () => {
        prelude = true;
        return 'keyword';
      },
    ],
    [
      /[{};]/y,
      (match) => {
        prelude = false;
        if (match[0] !== ';') depth = Math.max(0, depth + (match[0] === '{' ? 1 : -1));
        return 'punctuation';
      },
    ],
    [/#[\da-f]{3,8}\b/iy, () => (depth > 0 ? 'constant' : 'className')],
    [/-?\d*\.?\d+(?:%|[a-z]+)?/iy, 'constant'],
    [/!important\b/y, 'keyword'],
    [
      /-{0,2}[A-Za-z_][\w-]*/y,
      (match) => {
        if (prelude) return 'plain';
        if (depth === 0) return 'className';
        const rest = match.input.slice(match.index + match[0].length);
        if (/^\s*:/.test(rest)) return 'attrName';
        return /^\s*\(/.test(rest) ? 'function' : 'plain';
      },
    ],
    [/[.#][\w-]+/y, () => (depth > 0 ? 'plain' : 'className')],
    [/[:,>+~*()[\]=]/y, 'punctuation'],
  ];
  return scan(source, rules);
}

/** HTML: text and comments outside tags; a tag's name, attributes and values inside. */
function scanHtml(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const push = (kind: CodeTokenKind, text: string) => {
    if (text) tokens.push({ kind, text });
  };
  let at = 0;
  while (at < source.length) {
    const rest = source.slice(at);
    const comment = /^<!--[\s\S]*?(?:-->|$)/.exec(rest);
    if (comment) {
      push('comment', comment[0]);
      at += comment[0].length;
      continue;
    }
    const open = /^<\/?(?=[A-Za-z!?])/.exec(rest);
    if (open) {
      push('punctuation', open[0]);
      at += open[0].length;
      const name = /^[!?]?[\w:-]+/.exec(source.slice(at));
      if (name) {
        push('className', name[0]);
        at += name[0].length;
      }
      // Attributes up to the tag's end.
      while (at < source.length) {
        const inside = source.slice(at);
        const end = /^\/?>/.exec(inside);
        if (end) {
          push('punctuation', end[0]);
          at += end[0].length;
          break;
        }
        const piece =
          /^\s+/.exec(inside) ??
          /^"[^"]*"?|^'[^']*'?/.exec(inside) ??
          /^=/.exec(inside) ??
          /^[^\s=>"'/]+/.exec(inside) ??
          /^./.exec(inside);
        const text = piece?.[0] ?? inside;
        const kind: CodeTokenKind = /^\s/.test(text)
          ? 'plain'
          : /^["']/.test(text)
            ? 'attrValue'
            : text === '='
              ? 'operator'
              : text === '/'
                ? 'punctuation'
                : 'attrName';
        push(kind, text);
        at += text.length;
      }
      continue;
    }
    const text = /^[^<]+|^</.exec(rest)?.[0] ?? rest;
    const entity = text.split(/(&[#\w]+;)/);
    for (const part of entity) push(/^&[#\w]+;$/.test(part) ? 'constant' : 'plain', part);
    at += text.length;
  }
  return tokens;
}

/** Markdown, line by line: headings, fences, quotes and list markers, then inline marks. */
function scanMarkdown(source: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const inline: readonly Rule[] = [
    [/`[^`\n]+`/y, 'constant'],
    [/\*\*[^*\n]+\*\*|__[^_\n]+__/y, 'keyword'],
    [/\*[^*\n]+\*|_[^_\n]+_/y, 'string'],
    [/!?\[[^\]\n]*\]\([^)\n]*\)/y, 'attrValue'],
    [/<https?:[^>\n]+>/y, 'attrValue'],
  ];
  let fenced = false;
  source.split('\n').forEach((line, i) => {
    if (i > 0) tokens.push({ kind: 'plain', text: '\n' });
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      tokens.push({ kind: 'punctuation', text: line });
      return;
    }
    if (fenced) {
      if (line) tokens.push({ kind: 'string', text: line });
      return;
    }
    if (/^#{1,6}(\s|$)/.test(line)) {
      tokens.push({ kind: 'keyword', text: line });
      return;
    }
    const marker = /^(\s*)(>+|[-*+]|\d+[.)])(\s+)/.exec(line);
    let rest = line;
    if (marker) {
      if (marker[1]) tokens.push({ kind: 'plain', text: marker[1] });
      tokens.push({ kind: 'punctuation', text: marker[2] as string });
      tokens.push({ kind: 'plain', text: marker[3] as string });
      rest = line.slice(marker[0].length);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      tokens.push({ kind: 'punctuation', text: line });
      return;
    }
    tokens.push(...scan(rest, inline));
  });
  return tokens;
}

/** `source` as lines of highlighted runs, for `language` (a stored id or an alias). */
export function highlightCode(source: string, language: unknown): CodeToken[][] {
  const id = codeLanguage(language);
  switch (id) {
    case 'javascript':
      return tokenizeCode(source, 'jsx');
    case 'typescript':
      return tokenizeCode(source, 'tsx');
    case 'json':
      return toLines(scan(source, JSON_RULES));
    case 'python':
      return toLines(scan(source, PYTHON_RULES));
    case 'bash':
      return toLines(scan(source, BASH_RULES));
    case 'sql':
      return toLines(scan(source, SQL_RULES));
    case 'css':
      return toLines(scanCss(source));
    case 'html':
      return toLines(scanHtml(source));
    case 'markdown':
      return toLines(scanMarkdown(source));
    default:
      return source
        .split('\n')
        .map((line) => (line ? [{ kind: 'plain' as const, text: line }] : []));
  }
}
