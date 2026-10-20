/**
 * The SQL view engine against its JS reference, on a real PostgreSQL.
 *
 * One database with every stored property type and a few hundred rows of
 * seeded random values — empty and absent ones, values of another type's
 * shape (a property's type can change under its values), ties, case, accents,
 * canonically equivalent spellings, digits as text — then systematic and
 * random filter trees, sorts and searches. For each, every page is walked
 * through the cursor, and the ids in order must be exactly what
 * `evaluateFilter` and a stable `compareBySorts` give over the same rows, with
 * `total` on every page. Grouped, each row once per group it is in, in the
 * order and with the counts `groups.ts` gives — by every groupable type,
 * numbers by ranges, groups ordered first and hidden; and every footer
 * calculation of every type, over the whole view and per group, as
 * `calculations.ts` computes it in JS.
 */
import { eq } from 'drizzle-orm';
import {
  CALCULATIONS_BY_TYPE,
  FILTER_OPERATORS_BY_TYPE as OPERATORS_BY_TYPE,
} from '@oxy.so/nilo-contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeTestDb,
  getTestDb,
  seedWorkspace,
  type TestDatabase,
} from '../../db/__tests__/testDatabase.js';
import {
  databases,
  type DatabaseProperty,
  type Filter,
  type FilterGroup,
  type ViewSort,
} from '../../db/schema/databases.js';
import { pages } from '../../db/schema/pages.js';
import { listDatabaseRows, type PageRow } from '../../repositories/pages.js';
import {
  calculate,
  calculateGroups,
  calculationsInSql,
  groupCalculationsInSql,
} from './calculations.js';
import { evaluateFilter, valueType } from './filters.js';
import {
  countGroups,
  type GroupKey,
  type GroupSections,
  type GroupSpec,
  groupRows,
  needsNumberBounds,
  numberBounds,
  resolveGroupSpec,
  shownRows,
  summarizeGroups,
} from './groups.js';
import { compareBySorts } from './sorts.js';
import {
  compileView,
  decodeRowsCursor,
  listViewGroups,
  listViewRows,
  numberBoundsInSql,
} from './view-query.js';

/** mulberry32: a small seeded generator, so a failure replays. */
function generator(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = generator(0x5eed_2026);
const chance = (p: number) => random() < p;
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
const some = <T>(items: readonly T[], max: number): T[] =>
  Array.from({ length: between(0, max) }, () => pick(items));

const NOW = Date.UTC(2026, 9, 16, 12, 34, 56, 789);
const DAY = 86_400_000;

const WORDS = [
  'apple',
  'Apple',
  'APPLE',
  'äpple',
  'Äpple',
  'apple pie',
  'apple-pie',
  'applepie',
  'banana',
  'Banana',
  'résumé',
  'resume',
  'Résumé',
  'RESUME',
  'cafe',
  'café',
  'café',
  'CAFÉ',
  'zebra',
  'Zebra',
  'ñandú',
  'Ñandu',
  'naïve',
  'naive',
  '10',
  '9',
  '2',
  '100',
  '1.5',
  '-3',
  ' leading',
  'trailing ',
  '_under',
  '(paren)',
  'İstanbul',
  'istanbul',
  'ΟΔΟΣ',
  'οδος',
  'straße',
  'STRASSE',
  'ẞig',
  'emoji 🎉',
  '日本',
  'x',
  'X',
  '',
  'a b',
  'ab',
  'Ǆemal',
  'ǅemal',
  'ﬁne',
  'fine',
];
const text = () => (chance(0.3) ? `${pick(WORDS)} ${pick(WORDS)}` : pick(WORDS));
const USERS = ['u-ana', 'u-Bob', 'u-çé', 'u-10', 'u-9'];
const PAGE_IDS = ['p-1', 'p-2', 'p-10', 'P-3', 'p-é'];

const instant = (spreadDays: number) =>
  new Date(NOW + Math.round((random() * 2 - 1) * spreadDays * DAY)).toISOString();
function dateString(): string {
  const iso = instant(chance(0.7) ? 60 : 4000);
  if (chance(0.15)) return iso.slice(0, 10);
  if (chance(0.1)) return `${iso.slice(0, 19)}+02:00`;
  if (chance(0.1)) return `${iso.slice(0, 16)}Z`;
  return iso;
}

const SELECT_OPTIONS = ['listed-first', 'opt-a', 'it\'s "quoted"', 'opt-b'];
const STATUS_OPTIONS = ['done', 'doing', 'todo'];
const LABELS = ['l-red', 'l-Blue', 'l-é', 'l-10', 'l-9'];

const PROPERTIES: DatabaseProperty[] = [
  { id: 'name', name: 'Name', type: 'text' },
  { id: `t'1 "x"`, name: 'Text', type: 'text' },
  { id: 't2', name: 'Text 2', type: 'text' },
  { id: 'n1', name: 'Number', type: 'number' },
  { id: 'n2', name: 'Number 2', type: 'number' },
  {
    id: 's1',
    name: 'Select',
    type: 'select',
    config: { options: SELECT_OPTIONS.map((id) => ({ id, name: id, color: 'default' })) },
  },
  {
    id: 'st',
    name: 'Status',
    type: 'status',
    config: {
      options: STATUS_OPTIONS.map((id) => ({ id, name: id, color: 'default' })),
      // Grouped in another order than listed: a status groups in its groups' order.
      groups: [
        { id: 'todo', optionIds: ['todo'] },
        { id: 'in_progress', optionIds: ['doing'] },
        { id: 'complete', optionIds: ['done'] },
      ],
    },
  },
  {
    id: 'ms',
    name: 'Labels',
    type: 'multi_select',
    config: { options: LABELS.map((id) => ({ id, name: id, color: 'default' })) },
  },
  { id: 'd1', name: 'Date', type: 'date' },
  { id: 'd2', name: 'Messy date', type: 'date' },
  { id: 'p1', name: 'People', type: 'person' },
  { id: 'f1', name: 'Files', type: 'files' },
  { id: 'c1', name: 'Done', type: 'checkbox' },
  { id: 'u1', name: 'URL', type: 'url' },
  { id: 'e1', name: 'Email', type: 'email' },
  { id: 'ph', name: 'Phone', type: 'phone' },
  { id: 'r1', name: 'Related', type: 'relation' },
  { id: 'ct', name: 'Created', type: 'created_time' },
  { id: 'et', name: 'Edited', type: 'last_edited_time' },
  { id: 'cb', name: 'Created by', type: 'created_by' },
  { id: 'eb', name: 'Edited by', type: 'last_edited_by' },
  { id: 'id', name: 'ID', type: 'unique_id' },
];
const propertyById = new Map(PROPERTIES.map((p) => [p.id, p]));
/** `d2` holds dates JavaScript reads as NaN, which its comparator cannot order. */
const SORTABLE = PROPERTIES.filter((p) => p.id !== 'd2');

/** A value of another type's shape, as a retyped property keeps. */
const foreign = (): unknown =>
  pick([
    { text: pick(WORDS) },
    { value: pick(WORDS) },
    { number: 4 },
    { optionId: pick(SELECT_OPTIONS) },
    { optionIds: [pick(LABELS)] },
    { start: instant(30), end: null, includeTime: true },
    { userIds: [pick(USERS)] },
    { pageIds: [pick(PAGE_IDS)] },
    { checked: true },
    { files: [{ name: pick(WORDS), url: 'https://example.test/f' }] },
    'a bare string',
    7,
    false,
    [],
    ['l-red'],
  ]);

/** One stored value for a property: absent (`undefined`), JSON null, empty, foreign or proper. */
function value(property: DatabaseProperty, row: number): unknown {
  if (property.type === 'unique_id') return chance(0.1) ? undefined : { number: row + 1 };
  const roll = random();
  if (roll < 0.1) return undefined;
  if (roll < 0.14) return null;
  if (roll < 0.22) return foreign();
  switch (property.type) {
    case 'text':
      return pick([
        { text: text() },
        { text: text() },
        { text: '' },
        { value: text() },
        { text: '', value: 'hidden' },
      ]);
    case 'url':
    case 'email':
    case 'phone':
      return pick([{ value: text() }, { value: text() }, { value: '' }, { text: text() }]);
    case 'number':
      return {
        number: pick([0, 1, -1, 2.5, 10, 9, 100, -0.5, 1e-7, 1e20, 3, 3, 3, 0.1 + 0.2, null]),
      };
    case 'select':
      return { optionId: pick([...SELECT_OPTIONS, 'ghost', null, '']) };
    case 'status':
      return { optionId: pick([...STATUS_OPTIONS, null]) };
    case 'multi_select':
      return { optionIds: some([...LABELS, 'ghost'], 3) };
    case 'person':
      return { userIds: some(USERS, 3) };
    case 'relation':
      return { pageIds: some(PAGE_IDS, 3) };
    case 'files':
      return {
        files: some(['a.pdf', 'B.png', 'é.txt', '10.doc', '9.doc'], 2).map((name) => ({
          name,
          url: 'https://example.test/file',
        })),
      };
    case 'checkbox':
      return { checked: chance(0.5) };
    case 'date': {
      if (property.id === 'd2' && chance(0.3)) {
        return {
          start: pick(['garbage', '2024-13-01T00:00:00Z', '2024-01-01T25:00:00Z', '', null]),
        };
      }
      return { start: dateString(), end: null, includeTime: chance(0.5) };
    }
    default:
      return undefined;
  }
}

function filterValue(property: DatabaseProperty | undefined, operator: string): unknown {
  if (!property) return pick([text(), undefined]);
  if (operator === 'in_last' || operator === 'in_next') {
    return pick([7, 30, 0, 1.5, -3, '10', 'abc', undefined, 365]);
  }
  switch (valueType(property, null)) {
    case 'text':
    case 'url':
    case 'email':
    case 'phone': {
      const word = pick(WORDS);
      const start = between(0, word.length);
      return pick([
        word,
        word.toUpperCase(),
        word.slice(start, start + between(0, 4)),
        '',
        undefined,
        null,
        5,
      ]);
    }
    case 'number':
      return pick([
        0,
        1,
        2.5,
        -1,
        3,
        10,
        '3',
        '',
        null,
        undefined,
        'abc',
        1e20,
        'Infinity',
        '1e-7',
      ]);
    case 'select':
      return pick([...SELECT_OPTIONS, 'ghost', undefined, null]);
    case 'status':
      return pick([...STATUS_OPTIONS, 'ghost']);
    case 'multi_select':
      return pick([...LABELS, 'ghost', '', undefined]);
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return pick([...USERS, '', undefined]);
    case 'relation':
      return pick([...PAGE_IDS, undefined]);
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return pick([instant(60), instant(60).slice(0, 10), '', 'garbage', undefined, instant(5)]);
    case 'checkbox':
      return pick([true, false, 'false', 0, 1, null, undefined, '']);
    default:
      return undefined;
  }
}

const ALL_OPERATORS = [...new Set(Object.values(OPERATORS_BY_TYPE).flat())];

function condition(): Filter {
  const property = chance(0.05) ? undefined : pick(PROPERTIES);
  const operators = property ? OPERATORS_BY_TYPE[property.type] : ALL_OPERATORS;
  const roll = random();
  const operator =
    roll < 0.75
      ? pick(operators)
      : roll < 0.9
        ? pick(['is_empty', 'is_not_empty'])
        : pick(ALL_OPERATORS);
  return {
    kind: 'condition',
    propertyId: property?.id ?? 'ghost-property',
    operator,
    value: filterValue(property, operator),
  };
}

function group(depth: number): FilterGroup {
  return {
    kind: 'group',
    combinator: chance(0.5) ? 'and' : 'or',
    filters: Array.from({ length: between(0, depth === 0 ? 4 : 3) }, () =>
      depth < 2 && chance(0.3) ? group(depth + 1) : condition(),
    ),
  };
}

function sorts(): ViewSort[] {
  return Array.from({ length: between(0, 3) }, () => ({
    propertyId: chance(0.05) ? 'ghost-property' : pick(SORTABLE).id,
    direction: chance(0.5) ? ('asc' as const) : ('desc' as const),
  }));
}

function search(): string | undefined {
  if (chance(0.7)) return undefined;
  const word = pick(WORDS);
  return pick([word, word.toUpperCase(), word.slice(0, 2), 'é', 'i̇', 'ς']);
}

interface ViewCase {
  filters: FilterGroup;
  sorts: ViewSort[];
  search?: string;
  pageSize: number;
}

let db: TestDatabase;
let databaseId: string;
let reference: PageRow[];

beforeAll(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  db = await getTestDb();
  const workspaceId = await seedWorkspace(db, 'view-query');
  const [database] = await db
    .insert(databases)
    .values({
      workspaceId,
      name: 'Oracle',
      ownerId: 'u-ana',
      propertiesSchema: { properties: PROPERTIES },
    })
    .returning({ id: databases.id });
  databaseId = database.id;

  // Creation times from a small set, so many rows tie on them and the id decides.
  const createdTimes = Array.from({ length: 90 }, () => new Date(instant(60)));
  const rows = Array.from({ length: 320 }, (_, row) => {
    const properties: Record<string, unknown> = {};
    for (const property of PROPERTIES) {
      if (
        property.id === 'name' ||
        property.type.endsWith('_time') ||
        property.type.endsWith('_by')
      ) {
        continue;
      }
      const v = value(property, row);
      if (v !== undefined) properties[property.id] = v;
    }
    return {
      workspaceId,
      databaseId,
      title: chance(0.1) ? '' : text(),
      ownerId: chance(0.05) ? '' : pick(USERS),
      lastEditedBy: chance(0.3) ? null : chance(0.05) ? '' : pick(USERS),
      properties,
      createdAt: pick(createdTimes),
      updatedAt: new Date(instant(60)),
      // Never listed: archived rows and templates.
      archived: chance(0.05),
      template: chance(0.03),
      order: row,
    };
  });
  await db.insert(pages).values(rows);
  reference = await listDatabaseRows(db, databaseId, { archived: false, template: false });
  expect(reference.length).toBeGreaterThan(250);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await closeTestDb();
});

/** The ids the JS path gives, in its order. */
function expected(view: ViewCase): string[] {
  let rows = reference;
  if (view.search) {
    const needle = view.search.toLowerCase();
    rows = rows.filter((r) => r.title.toLowerCase().includes(needle));
  }
  if (view.filters.filters.length > 0) {
    rows = rows.filter((r) => evaluateFilter(view.filters, r, propertyById));
  }
  if (view.sorts.length > 0) rows = [...rows].sort(compareBySorts(view.sorts, propertyById));
  return rows.map((r) => r.id);
}

/** The ids the SQL path gives, every page walked through its cursor. */
async function actual(view: ViewCase): Promise<{ ids: string[]; totals: Set<number> }> {
  const compiled = compileView(databaseId, view, propertyById);
  const ids: string[] = [];
  const totals = new Set<number>();
  let cursor: string | null = null;
  for (let pageNo = 0; pageNo < 1000; pageNo += 1) {
    const page = await listViewRows(db, databaseId, compiled, {
      size: view.pageSize,
      cursor: cursor === null ? null : decodeRowsCursor(cursor),
    });
    if (!page) throw new Error('A cursor the API issued was refused');
    ids.push(...page.rows.map((r) => r.id));
    totals.add(page.total);
    expect(page.rows.length).toBeLessThanOrEqual(view.pageSize);
    cursor = page.cursor;
    if (!cursor) break;
    expect(page.rows.length).toBe(view.pageSize);
  }
  return { ids, totals };
}

async function check(view: ViewCase) {
  const want = expected(view);
  const got = await actual(view);
  if (JSON.stringify(got.ids) !== JSON.stringify(want)) {
    const at = got.ids.findIndex((id, i) => id !== want[i]);
    const show = (id: string | undefined) => {
      const row = reference.find((r) => r.id === id);
      return row && { title: row.title, properties: row.properties, createdAt: row.createdAt };
    };
    throw new Error(
      `SQL and JS disagree at ${at} (${got.ids.length} vs ${want.length} rows) for ${JSON.stringify(view)}: ` +
        `SQL ${JSON.stringify(show(got.ids[at]))}, JS ${JSON.stringify(show(want[at]))}`,
    );
  }
  expect([...got.totals]).toEqual([want.length]);
  return want.length;
}

const only = (filter: Filter): FilterGroup => ({
  kind: 'group',
  combinator: 'and',
  filters: [filter],
});

describe('a view in SQL', () => {
  it('matches the JS path for every property type and operator', async () => {
    let cases = 0;
    let matched = 0;
    for (const property of [...PROPERTIES, undefined]) {
      const operators = property ? OPERATORS_BY_TYPE[property.type] : ALL_OPERATORS;
      for (const operator of [...operators, 'is_empty', 'is_not_empty', 'no_such_operator']) {
        for (let i = 0; i < 4; i += 1) {
          const filters = only({
            kind: 'condition',
            propertyId: property?.id ?? 'ghost-property',
            operator,
            value: filterValue(property, operator),
          });
          matched += await check({ filters, sorts: [], pageSize: 500 });
          cases += 1;
        }
      }
    }
    // Most conditions select some rows and leave others: the oracle is not vacuous.
    expect(cases).toBeGreaterThan(400);
    expect(matched).toBeGreaterThan(cases * 20);
  });

  it('sorts every property type in both directions as the JS path does', async () => {
    for (const property of [...SORTABLE, undefined]) {
      for (const direction of ['asc', 'desc'] as const) {
        const sort = { propertyId: property?.id ?? 'ghost-property', direction };
        await check({ filters: only(group(1)), sorts: [sort], pageSize: 23 });
        await check({ filters: group(2), sorts: [sort], pageSize: between(1, 9) });
      }
    }
  });

  it('matches the JS path on random filter trees, sorts, searches and page sizes', async () => {
    let nonEmpty = 0;
    for (let i = 0; i < 400; i += 1) {
      const view: ViewCase = {
        filters: group(0),
        sorts: sorts(),
        search: search(),
        pageSize: pick([1, 3, 7, 16, 41, 97, 500]),
      };
      if (view.pageSize === 1 && expected(view).length > 60) view.pageSize = 16;
      if ((await check(view)) > 0) nonEmpty += 1;
    }
    expect(nonEmpty).toBeGreaterThan(200);
  });

  it('keeps the rows with no value in the negative operators, as in Notion', async () => {
    for (const [propertyId, operator, value] of [
      ['s1', 'is_not', 'opt-a'],
      ['st', 'is_not', 'done'],
      ['ms', 'does_not_contain', 'l-red'],
      ['p1', 'does_not_contain', 'u-ana'],
      ['r1', 'does_not_contain', 'p-1'],
    ] as const) {
      const filters = only({ kind: 'condition', propertyId, operator, value });
      const empty = reference.filter((r) => r.properties[propertyId] === undefined);
      expect(empty.length).toBeGreaterThan(0);
      const { ids } = await actual({ filters, sorts: [], pageSize: 500 });
      for (const row of empty) expect(ids).toContain(row.id);
      await check({ filters, sorts: [], pageSize: 500 });
    }
  });

  it('names its row in the cursor when the sort values are too long to carry', async () => {
    const long = 'z'.repeat(3000);
    const target = reference[0] as PageRow;
    await db
      .update(pages)
      .set({ properties: { ...target.properties, t2: { text: long } } })
      .where(eq(pages.id, target.id));
    const view: ViewCase = {
      filters: only({ kind: 'condition', propertyId: 't2', operator: 'starts_with', value: 'z' }),
      sorts: [{ propertyId: 't2', direction: 'desc' }],
      pageSize: 1,
    };
    const compiled = compileView(databaseId, view, propertyById);
    const first = await listViewRows(db, databaseId, compiled, { size: 1, cursor: null });
    expect(first?.rows[0]?.id).toBe(target.id);
    const cursor = decodeRowsCursor(first?.cursor ?? '');
    expect(cursor).toEqual({ row: target.id });
    reference = await listDatabaseRows(db, databaseId, { archived: false, template: false });
    await check(view);
  });
});

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const GROUPABLE = [
  's1',
  'st',
  'ms',
  'p1',
  'c1',
  'd1',
  'd2',
  `t'1 "x"`,
  'name',
  'u1',
  'cb',
  'eb',
  'n1',
  'n2',
];
const DATED = ['d1', 'd2', 'ct', 'et'];
const ZONES = ['UTC', 'America/New_York', 'Asia/Kathmandu', 'Pacific/Kiritimati'];

interface GroupedCase extends ViewCase {
  spec: GroupSpec;
}

function groupSpec(propertyId: string, sections: GroupSections = {}): GroupSpec {
  const groupBy = { propertyId, granularity: pick(['day', 'week', 'month', 'year'] as const) };
  // A number with no ranges of the view's own spans every row's numbers.
  const numeric = needsNumberBounds(groupBy, propertyById, sections);
  const bounds = numeric ? numberBounds(reference, numeric) : undefined;
  const spec = resolveGroupSpec(groupBy, propertyById, pick(ZONES), sections, bounds);
  if (!spec) throw new Error(`${propertyId} cannot group`);
  return spec;
}

/** Ranges of a number a view might set: aligned or not, wide or narrow, with values outside. */
function numberGrouping(): GroupSections['numberGrouping'] {
  const from = pick([-1, 0, 0.1, 2, -0.5, 3]);
  const step = pick([0.1, 0.5, 1, 2.5, 3, 0.3]);
  const to = from + pick([step * between(1, 30), between(1, 40) * 0.37, 1e21]);
  return { from, to, step };
}

/**
 * A grouping of `propertyId` with the sections a view might set: some of its
 * groups first in some order, some hidden (the empty one among them, or a key
 * no group has), a number's ranges.
 */
function sectionedSpec(propertyId: string): GroupSpec {
  const plain = groupSpec(propertyId);
  const keys = summarizeGroups(countGroups(groupRows(reference, plain)), plain).map((g) => g.key);
  const shuffled = [...keys, 'no-such-group'].sort(() => random() - 0.5);
  const sections: GroupSections = {
    ...(chance(0.6) && { groupOrder: shuffled.slice(0, between(1, shuffled.length)) }),
    ...(chance(0.6) && { hiddenGroups: some(shuffled, Math.min(3, shuffled.length)) }),
    ...(plain.numbers && chance(0.6) && { numberGrouping: numberGrouping() }),
  };
  // Each group once, as the API keeps them.
  if (sections.hiddenGroups) sections.hiddenGroups = [...new Set(sections.hiddenGroups)];
  return groupSpec(propertyId, sections);
}

/** The rows a view shows before grouping (filtered, searched, sorted), as the JS path has them. */
function viewRows(view: ViewCase): PageRow[] {
  let rows = reference;
  if (view.search) {
    const needle = view.search.toLowerCase();
    rows = rows.filter((r) => r.title.toLowerCase().includes(needle));
  }
  if (view.filters.filters.length > 0) {
    rows = rows.filter((r) => evaluateFilter(view.filters, r, propertyById));
  }
  if (view.sorts.length > 0) rows = [...rows].sort(compareBySorts(view.sorts, propertyById));
  return rows;
}

/** The (row, group) entries the JS path gives, in its order. */
function expectedGroups(view: GroupedCase): { id: string; key: GroupKey }[] {
  return groupRows(viewRows(view), view.spec).map(({ row, key }) => ({ id: row.id, key }));
}

async function checkGrouped(view: GroupedCase): Promise<number> {
  const want = expectedGroups(view);
  const compiled = compileView(databaseId, view, propertyById, view.spec);
  const got: { id: string; key: GroupKey }[] = [];
  const totals = new Set<number>();
  let cursor: string | null = null;
  for (let pageNo = 0; pageNo < 2000; pageNo += 1) {
    const page = await listViewRows(db, databaseId, compiled, {
      size: view.pageSize,
      cursor: cursor === null ? null : decodeRowsCursor(cursor),
    });
    if (!page) throw new Error('A cursor the API issued was refused');
    page.rows.forEach((row, i) => {
      got.push({ id: row.id, key: page.groupKeys?.[i] ?? null });
    });
    totals.add(page.total);
    cursor = page.cursor;
    if (!cursor) break;
  }
  // The rows shown, each once: those in some group the view does not hide.
  expect([...totals]).toEqual([shownRows(viewRows(view), view.spec).length]);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    const at = got.findIndex((e, i) => JSON.stringify(e) !== JSON.stringify(want[i]));
    throw new Error(
      `SQL and JS group apart at ${at} (${got.length} vs ${want.length}) for ${JSON.stringify({
        ...view,
        spec: { ...view.spec, property: view.spec.property.id },
      })}: SQL ${JSON.stringify(got[at])}, JS ${JSON.stringify(want[at])}`,
    );
  }
  // Every row once in each of its groups, and the groups never come back once left.
  const seen = new Set<GroupKey>();
  for (const [i, entry] of got.entries()) {
    if (i > 0 && got[i - 1]?.key !== entry.key) {
      expect(seen.has(entry.key)).toBe(false);
    }
    seen.add(entry.key);
  }
  const counts = await listViewGroups(db, compiled);
  expect(summarizeGroups(new Map([...counts].map(([k, v]) => [k, v.count])), view.spec)).toEqual(
    summarizeGroups(countGroups(want), view.spec),
  );
  return new Set(want.map((e) => e.key)).size;
}

describe('a grouped view in SQL', () => {
  it('groups by every groupable property as the JS path does', async () => {
    let groups = 0;
    for (const propertyId of [...GROUPABLE, ...DATED]) {
      for (let i = 0; i < 6; i += 1) {
        groups += await checkGrouped({
          spec: groupSpec(propertyId),
          filters: chance(0.5) ? only(group(1)) : { kind: 'group', combinator: 'and', filters: [] },
          sorts: sorts(),
          search: search(),
          pageSize: pick([1, 7, 16, 41, 500]),
        });
      }
    }
    // The groups are many: most properties split the rows several ways.
    expect(groups).toBeGreaterThan(300);
    // Ninety-six views, each read page by page in SQL and in JS: past the
    // suite's 30 s on a shared CI runner, not stuck.
  }, 120_000);

  it('puts a row with several labels or people in each of their groups', async () => {
    for (const propertyId of ['ms', 'p1']) {
      const spec = groupSpec(propertyId);
      const view: GroupedCase = {
        spec,
        filters: { kind: 'group', combinator: 'and', filters: [] },
        sorts: [],
        pageSize: 13,
      };
      const entries = expectedGroups(view);
      expect(entries.length).toBeGreaterThan(reference.length);
      await checkGrouped(view);
    }
  });

  it('groups numbers by ranges, the bounds of a view that sets none read in SQL as in JS', async () => {
    for (const propertyId of ['n1', 'n2']) {
      const property = propertyById.get(propertyId) as DatabaseProperty;
      expect(await numberBoundsInSql(db, databaseId, property)).toEqual(
        numberBounds(reference, property),
      );
      for (let i = 0; i < 12; i += 1) {
        const sections: GroupSections = i < 2 ? {} : { numberGrouping: numberGrouping() };
        const spec = groupSpec(propertyId, sections);
        expect(spec.numbers).toBeDefined();
        await checkGrouped({
          spec,
          filters: chance(0.5) ? only(group(1)) : { kind: 'group', combinator: 'and', filters: [] },
          sorts: sorts(),
          search: search(),
          pageSize: pick([1, 7, 41, 500]),
        });
      }
    }
    // A range a value sits at the edge of: [0.1, 0.4) holds 0.30000000000000004, not 0.4.
    const spec = groupSpec('n1', { numberGrouping: { from: 0.1, to: 0.4, step: 0.1 } });
    const groups = summarizeGroups(countGroups(groupRows(reference, spec)), spec);
    expect(groups.slice(0, 4).map((g) => [g.key, g.range])).toEqual([
      ['-1', { from: null, to: 0.1 }],
      ['0', { from: 0.1, to: 0.2 }],
      ['1', { from: 0.2, to: 0.30000000000000004 }],
      ['2', { from: 0.30000000000000004, to: 0.4 }],
    ]);
  }, 120_000);

  it('puts the groups a view orders first before the others, and leaves out those it hides', async () => {
    let hidden = 0;
    for (const propertyId of [...GROUPABLE, ...DATED]) {
      for (let i = 0; i < 3; i += 1) {
        const spec = sectionedSpec(propertyId);
        hidden += spec.hidden?.length ?? 0;
        await checkGrouped({
          spec,
          filters: chance(0.5) ? only(group(1)) : { kind: 'group', combinator: 'and', filters: [] },
          sorts: sorts(),
          search: search(),
          pageSize: pick([1, 7, 41, 500]),
        });
      }
    }
    expect(hidden).toBeGreaterThan(20);
    // Fifty-four views read page by page: a long test on a shared CI runner, not a stuck one.
  }, 120_000);

  it('lists every option, even one no row holds, the empty group last', async () => {
    const spec = groupSpec('s1');
    const none: FilterGroup = only({
      kind: 'condition',
      propertyId: 's1',
      operator: 'is',
      value: 'opt-a',
    });
    const compiled = compileView(databaseId, { filters: none }, propertyById, spec);
    const counts = await listViewGroups(db, compiled);
    const summary = summarizeGroups(new Map([...counts].map(([k, v]) => [k, v.count])), spec);
    expect(summary.map((g) => g.key)).toEqual(SELECT_OPTIONS);
    expect(summary.filter((g) => g.count > 0).map((g) => g.key)).toEqual(['opt-a']);
  });

  it('names its row and its group in the cursor when the sort values are too long', async () => {
    // Two rows of its own whose sort values are too long to carry, so the
    // first page of one row always has a next one: nothing left by an
    // earlier test, or by the seeded data, decides it.
    for (const [i, row] of (reference.slice(0, 2) as PageRow[]).entries()) {
      await db
        .update(pages)
        .set({ properties: { ...row.properties, t2: { text: 'z'.repeat(3000 - i) } } })
        .where(eq(pages.id, row.id));
    }
    reference = await listDatabaseRows(db, databaseId, { archived: false, template: false });
    const view: GroupedCase = {
      spec: groupSpec('p1'),
      filters: only({ kind: 'condition', propertyId: 't2', operator: 'starts_with', value: 'z' }),
      sorts: [{ propertyId: 't2', direction: 'desc' }],
      pageSize: 1,
    };
    const compiled = compileView(databaseId, view, propertyById, view.spec);
    const first = await listViewRows(db, databaseId, compiled, { size: 1, cursor: null });
    const cursor = decodeRowsCursor(first?.cursor ?? '');
    expect(cursor && 'row' in cursor && 'group' in cursor).toBe(true);
    await checkGrouped(view);
  });
});

// ---------------------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------------------

function close(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

describe('calculations in SQL', () => {
  it('compute every function of every stored type as the JS path does', async () => {
    let compared = 0;
    let nonZero = 0;
    for (const property of PROPERTIES) {
      for (const fn of CALCULATIONS_BY_TYPE[property.type]) {
        for (let i = 0; i < 3; i += 1) {
          const view: ViewCase = {
            filters: i === 0 ? { kind: 'group', combinator: 'and', filters: [] } : group(1),
            sorts: [],
            search: i === 2 ? search() : undefined,
            pageSize: 1,
          };
          const compiled = compileView(databaseId, view, propertyById);
          const [got] = await calculationsInSql(db, compiled, [{ property, fn }]);
          const rows = reference.filter(
            (r) =>
              (!view.search || r.title.toLowerCase().includes(view.search.toLowerCase())) &&
              evaluateFilter(view.filters, r, propertyById),
          );
          const want = calculate(fn, property, rows);
          if (!close(got ?? null, want)) {
            throw new Error(
              `${fn} of ${property.id}: SQL ${got}, JS ${want} for ${JSON.stringify(view)}`,
            );
          }
          compared += 1;
          if (want) nonZero += 1;
        }
      }
    }
    expect(compared).toBeGreaterThan(300);
    expect(nonZero).toBeGreaterThan(compared * 0.6);
    // Every function of every type, three ways each: a long test, not a stuck one.
  }, 120_000);

  it('compute every function of every stored type per group, in one query, as the JS path does', async () => {
    const every = PROPERTIES.flatMap((property) =>
      CALCULATIONS_BY_TYPE[property.type].map((fn) => ({ property, fn })),
    );
    let groupsCompared = 0;
    for (const propertyId of [...GROUPABLE, ...DATED]) {
      for (let i = 0; i < 2; i += 1) {
        const spec = i === 0 ? groupSpec(propertyId) : sectionedSpec(propertyId);
        const view: ViewCase = {
          filters: i === 0 ? { kind: 'group', combinator: 'and', filters: [] } : group(1),
          sorts: [],
          search: chance(0.3) ? search() : undefined,
          pageSize: 1,
        };
        const compiled = compileView(databaseId, view, propertyById, spec);
        const [got, whole] = await Promise.all([
          groupCalculationsInSql(db, compiled, every),
          calculationsInSql(db, compiled, every),
        ]);
        const rows = viewRows(view);
        const want = calculateGroups(rows, spec, every);
        const describe = () =>
          JSON.stringify({ ...view, spec: { ...spec, property: spec.property.id } });
        expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
        for (const [key, values] of want) {
          every.forEach(({ property, fn }, c) => {
            const sqlValue = got.get(key)?.[c] ?? null;
            if (!close(sqlValue, values[c] ?? null)) {
              throw new Error(
                `${fn} of ${property.id} in group ${key}: SQL ${sqlValue}, JS ${values[c]} for ${describe()}`,
              );
            }
          });
          groupsCompared += 1;
        }
        // The whole footer: the rows in a group the view shows.
        const shown = shownRows(rows, spec);
        every.forEach(({ property, fn }, c) => {
          const wantValue = calculate(fn, property, shown);
          if (!close(whole[c] ?? null, wantValue)) {
            throw new Error(
              `${fn} of ${property.id}: SQL ${whole[c]}, JS ${wantValue} for ${describe()}`,
            );
          }
        });
      }
    }
    expect(groupsCompared).toBeGreaterThan(150);
    // Every calculation of every group of thirty-six views: long on a CI runner, not stuck.
  }, 120_000);
});
