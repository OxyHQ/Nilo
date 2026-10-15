import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { en, es } from '../catalogs';

const APP_ROOT = resolve(__dirname, '../../..');
const SOURCE_DIRS = ['app', 'components', 'lib', 'hooks'];

function flatten(node: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === 'object') {
        for (const [k, v] of flatten(value, path)) out.set(k, v);
      } else {
        out.set(path, value);
      }
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(entry)) files.push(path);
  }
  return files;
}

/** Literal keys passed to `t('…')` / `i18n.t('…')` anywhere in the app. */
function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const pattern = /\bt\(\s*(['"])([A-Za-z0-9_.]+)\1/g;
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(join(APP_ROOT, dir))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(pattern)) {
        keys.set(match[2], file.slice(APP_ROOT.length + 1));
      }
    }
  }
  return keys;
}

const enKeys = flatten(en);
const esKeys = flatten(es);

describe('translation catalogs', () => {
  it('give English and Spanish the same keys', () => {
    const missingInEs = [...enKeys.keys()].filter((k) => !esKeys.has(k));
    const missingInEn = [...esKeys.keys()].filter((k) => !enKeys.has(k));
    expect({ missingInEs, missingInEn }).toEqual({ missingInEs: [], missingInEn: [] });
  });

  it('have no empty strings', () => {
    const empty = [...enKeys, ...esKeys].filter(
      ([, v]) => typeof v === 'string' && v.trim() === '',
    );
    expect(empty).toEqual([]);
  });

  it('define every key the code asks for', () => {
    const used = usedKeys();
    // Control: the scan must find the keys the settings screens already use,
    // or a broken pattern would pass this test vacuously.
    expect(used.has('feedback.thankYou')).toBe(true);
    const missing = [...used]
      .filter(([key]) => !enKeys.has(key) && !hasPluralForms(key))
      .map(([key, file]) => `${key} (${file})`);
    expect(missing).toEqual([]);
  });
});

/** i18n-js pluralization: `t('x.items', { count })` reads `x.items.one` / `.other`. */
function hasPluralForms(key: string): boolean {
  return enKeys.has(`${key}.one`) && enKeys.has(`${key}.other`);
}
