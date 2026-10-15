/**
 * Formulas: a small, Notion-like expression language over a row's values.
 *
 *   prop("Points") * 2
 *   if(prop("Done"), "✓ " + prop("Name"), prop("Name"))
 *   dateBetween(prop("Due"), now(), "days") < 3 and not prop("Done")
 *
 * Values are numbers, strings, booleans, dates and lists. Operators:
 * `+ - * / % ^`, comparisons `== != > >= < <=`, `and`, `or`, `not`; `+`
 * joins strings. A leading `=` is allowed. Nothing is ever `eval`ed:
 * expressions are tokenized, parsed into a tree and interpreted, with bounds
 * on length, depth and string size. An error makes the formula's value
 * empty (`null`), and the reason is returned beside it.
 */

export type FormulaValue = number | string | boolean | Date | FormulaValue[] | null;

export interface FormulaContext {
  /** A property's value by its name, as a formula sees it (`prop("…")`). */
  prop(name: string): FormulaValue;
  now(): Date;
}

export class FormulaError extends Error {}

const MAX_SOURCE = 4000;
const MAX_DEPTH = 64;
const MAX_STRING = 10_000;

// ───────────────────────────── tokens ─────────────────────────────

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'end' };

const OPERATORS = [
  '==',
  '!=',
  '>=',
  '<=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '>',
  '<',
  '(',
  ')',
  ',',
  '!',
];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(source[i + 1] ?? ''))) {
      const match = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ kind: 'number', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '“') {
      const close = ch === '“' ? '”' : ch;
      let value = '';
      i += 1;
      while (i < source.length && source[i] !== close) {
        if (source[i] === '\\' && i + 1 < source.length) {
          const next = source[i + 1] as string;
          value += next === 'n' ? '\n' : next;
          i += 2;
        } else {
          value += source[i];
          i += 1;
        }
      }
      if (source[i] !== close) throw new FormulaError('A text literal is not closed');
      i += 1;
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_]\w*/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ kind: 'name', value: match[0] });
      i += match[0].length;
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i));
    if (!op) throw new FormulaError(`Unexpected "${ch}"`);
    tokens.push({ kind: 'op', value: op });
    i += op.length;
  }
  tokens.push({ kind: 'end' });
  return tokens;
}

// ───────────────────────────── tree ─────────────────────────────

type Node =
  | { kind: 'literal'; value: FormulaValue }
  | { kind: 'unary'; op: string; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

const BINARY: Record<string, { precedence: number; right?: boolean; op: string }> = {
  or: { precedence: 1, op: 'or' },
  '||': { precedence: 1, op: 'or' },
  and: { precedence: 2, op: 'and' },
  '&&': { precedence: 2, op: 'and' },
  '==': { precedence: 3, op: '==' },
  '!=': { precedence: 3, op: '!=' },
  '>': { precedence: 4, op: '>' },
  '>=': { precedence: 4, op: '>=' },
  '<': { precedence: 4, op: '<' },
  '<=': { precedence: 4, op: '<=' },
  '+': { precedence: 5, op: '+' },
  '-': { precedence: 5, op: '-' },
  '*': { precedence: 6, op: '*' },
  '/': { precedence: 6, op: '/' },
  '%': { precedence: 6, op: '%' },
  '^': { precedence: 8, right: true, op: '^' },
};

function parse(source: string): Node {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos] as Token;
  const take = () => tokens[pos++] as Token;
  const expectOp = (op: string) => {
    const token = take();
    if (token.kind !== 'op' || token.value !== op) throw new FormulaError(`Expected "${op}"`);
  };
  const binaryOf = (token: Token) =>
    token.kind === 'op' ||
    (token.kind === 'name' && (token.value === 'and' || token.value === 'or'))
      ? BINARY[token.value as string]
      : undefined;

  const expression = (minPrecedence: number, depth: number): Node => {
    if (depth > MAX_DEPTH) throw new FormulaError('The formula is nested too deeply');
    let left = unary(depth);
    for (;;) {
      const info = binaryOf(peek());
      if (!info || info.precedence < minPrecedence) return left;
      take();
      const right = expression(info.right ? info.precedence : info.precedence + 1, depth + 1);
      left = { kind: 'binary', op: info.op, left, right };
    }
  };

  const unary = (depth: number): Node => {
    const token = peek();
    if (
      (token.kind === 'op' &&
        (token.value === '-' || token.value === '!' || token.value === '+')) ||
      (token.kind === 'name' && token.value === 'not')
    ) {
      take();
      const op = token.value === 'not' ? '!' : (token.value as string);
      // `not a == b` reads as not (a == b), like Notion; `-x` binds tightly.
      return {
        kind: 'unary',
        op,
        operand: op === '!' ? expression(3, depth + 1) : expression(7, depth + 1),
      };
    }
    return primary(depth);
  };

  const primary = (depth: number): Node => {
    const token = take();
    switch (token.kind) {
      case 'number':
      case 'string':
        return { kind: 'literal', value: token.value };
      case 'name': {
        if (token.value === 'true' || token.value === 'false')
          return { kind: 'literal', value: token.value === 'true' };
        const next = peek();
        if (next.kind !== 'op' || next.value !== '(')
          throw new FormulaError(`Unknown name "${token.value}"`);
        take();
        const args: Node[] = [];
        if (!(peek().kind === 'op' && (peek() as { value: string }).value === ')')) {
          for (;;) {
            args.push(expression(1, depth + 1));
            const sep = peek();
            if (sep.kind === 'op' && sep.value === ',') {
              take();
              continue;
            }
            break;
          }
        }
        expectOp(')');
        return { kind: 'call', name: token.value, args };
      }
      case 'op':
        if (token.value === '(') {
          const inner = expression(1, depth + 1);
          expectOp(')');
          return inner;
        }
        throw new FormulaError(`Unexpected "${token.value}"`);
      default:
        throw new FormulaError('The formula ends too soon');
    }
  };

  const tree = expression(1, 0);
  if (peek().kind !== 'end') throw new FormulaError('Unexpected text after the formula');
  return tree;
}

// ───────────────────────────── values ─────────────────────────────

const isEmpty = (value: FormulaValue): boolean =>
  value === null ||
  value === '' ||
  value === false ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'number' && Number.isNaN(value));

function toText(value: FormulaValue): string {
  if (value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toText).join(', ');
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(12)));
  return String(value);
}

function toNumber(value: FormulaValue, what: string): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)))
    return Number(value);
  throw new FormulaError(`${what} needs a number`);
}

function toDate(value: FormulaValue, what: string): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value);
  throw new FormulaError(`${what} needs a date`);
}

function text(value: string): string {
  if (value.length > MAX_STRING) throw new FormulaError('The text is too long');
  return value;
}

function equal(a: FormulaValue, b: FormulaValue): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => equal(x, b[i] as FormulaValue));
  return a === b;
}

function compare(a: FormulaValue, b: FormulaValue): number {
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return toNumber(a, 'Comparing') - toNumber(b, 'Comparing');
}

const UNITS: Record<string, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
};

function addToDate(date: Date, amount: number, unit: string): Date {
  const out = new Date(date.getTime());
  if (unit === 'months') out.setUTCMonth(out.getUTCMonth() + amount);
  else if (unit === 'years') out.setUTCFullYear(out.getUTCFullYear() + amount);
  else if (UNITS[unit]) out.setTime(out.getTime() + amount * (UNITS[unit] as number));
  else throw new FormulaError(`Unknown unit "${unit}"`);
  return out;
}

function between(a: Date, b: Date, unit: string): number {
  if (unit === 'months' || unit === 'years') {
    const months =
      (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + (a.getUTCMonth() - b.getUTCMonth());
    return Math.trunc(unit === 'years' ? months / 12 : months);
  }
  const size = UNITS[unit];
  if (!size) throw new FormulaError(`Unknown unit "${unit}"`);
  return Math.trunc((a.getTime() - b.getTime()) / size);
}

/** A small strftime-like subset: YYYY MM DD HH mm, and the default ISO date. */
function formatDate(date: Date, pattern?: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (!pattern) return date.toISOString().slice(0, 10);
  return pattern
    .replace(/YYYY/g, String(date.getUTCFullYear()))
    .replace(/MM/g, pad(date.getUTCMonth() + 1))
    .replace(/DD/g, pad(date.getUTCDate()))
    .replace(/HH/g, pad(date.getUTCHours()))
    .replace(/mm/g, pad(date.getUTCMinutes()));
}

type Fn = (args: Node[], run: (node: Node) => FormulaValue, ctx: FormulaContext) => FormulaValue;

const arity = (name: string, args: Node[], min: number, max = min) => {
  if (args.length < min || args.length > max) {
    throw new FormulaError(
      `${name}() takes ${min === max ? min : `${min} to ${max}`} argument${max === 1 ? '' : 's'}`,
    );
  }
};

const FUNCTIONS: Record<string, Fn> = {
  prop: (args, run, ctx) => {
    arity('prop', args, 1);
    const name = run(args[0] as Node);
    if (typeof name !== 'string') throw new FormulaError('prop() takes a property name');
    return ctx.prop(name);
  },
  if: (args, run) => {
    arity('if', args, 3);
    return isEmpty(run(args[0] as Node)) ? run(args[2] as Node) : run(args[1] as Node);
  },
  ifs: (args, run) => {
    if (args.length < 2) throw new FormulaError('ifs() takes conditions and values');
    for (let i = 0; i + 1 < args.length; i += 2)
      if (!isEmpty(run(args[i] as Node))) return run(args[i + 1] as Node);
    return args.length % 2 === 1 ? run(args[args.length - 1] as Node) : null;
  },
  empty: (args, run) => {
    arity('empty', args, 1);
    return isEmpty(run(args[0] as Node));
  },
  length: (args, run) => {
    arity('length', args, 1);
    const value = run(args[0] as Node);
    return Array.isArray(value) ? value.length : toText(value).length;
  },
  concat: (args, run) => text(args.map((a) => toText(run(a))).join('')),
  join: (args, run) => {
    arity('join', args, 2);
    const list = run(args[0] as Node);
    const separator = toText(run(args[1] as Node));
    return text((Array.isArray(list) ? list : [list]).map(toText).join(separator));
  },
  lower: (args, run) => (arity('lower', args, 1), toText(run(args[0] as Node)).toLowerCase()),
  upper: (args, run) => (arity('upper', args, 1), toText(run(args[0] as Node)).toUpperCase()),
  contains: (args, run) => {
    arity('contains', args, 2);
    const haystack = run(args[0] as Node);
    const needle = run(args[1] as Node);
    return Array.isArray(haystack)
      ? haystack.some((v) => equal(v, needle))
      : toText(haystack).includes(toText(needle));
  },
  replace: (args, run) => {
    arity('replace', args, 3);
    return text(
      toText(run(args[0] as Node)).replace(
        toText(run(args[1] as Node)),
        toText(run(args[2] as Node)),
      ),
    );
  },
  replaceAll: (args, run) => {
    arity('replaceAll', args, 3);
    return text(
      toText(run(args[0] as Node))
        .split(toText(run(args[1] as Node)))
        .join(toText(run(args[2] as Node))),
    );
  },
  slice: (args, run) => {
    arity('slice', args, 2, 3);
    const value = toText(run(args[0] as Node));
    const start = toNumber(run(args[1] as Node), 'slice()');
    return args[2] ? value.slice(start, toNumber(run(args[2]), 'slice()')) : value.slice(start);
  },
  format: (args, run) => (arity('format', args, 1), toText(run(args[0] as Node))),
  toNumber: (args, run) => {
    arity('toNumber', args, 1);
    const value = run(args[0] as Node);
    const n = typeof value === 'string' ? Number.parseFloat(value) : toNumber(value, 'toNumber()');
    return Number.isNaN(n) ? null : n;
  },
  round: (args, run) => {
    arity('round', args, 1, 2);
    const places = args[1] ? toNumber(run(args[1]), 'round()') : 0;
    const factor = 10 ** places;
    return Math.round(toNumber(run(args[0] as Node), 'round()') * factor) / factor;
  },
  floor: (args, run) => (
    arity('floor', args, 1), Math.floor(toNumber(run(args[0] as Node), 'floor()'))
  ),
  ceil: (args, run) => (
    arity('ceil', args, 1), Math.ceil(toNumber(run(args[0] as Node), 'ceil()'))
  ),
  abs: (args, run) => (arity('abs', args, 1), Math.abs(toNumber(run(args[0] as Node), 'abs()'))),
  sqrt: (args, run) => (
    arity('sqrt', args, 1), Math.sqrt(toNumber(run(args[0] as Node), 'sqrt()'))
  ),
  pow: (args, run) => (
    arity('pow', args, 2),
    toNumber(run(args[0] as Node), 'pow()') ** toNumber(run(args[1] as Node), 'pow()')
  ),
  min: (args, run) =>
    Math.min(...args.flatMap((a) => [run(a)].flat()).map((v) => toNumber(v, 'min()'))),
  max: (args, run) =>
    Math.max(...args.flatMap((a) => [run(a)].flat()).map((v) => toNumber(v, 'max()'))),
  sum: (args, run) =>
    args
      .flatMap((a) => [run(a)].flat())
      .reduce<number>((total, v) => total + toNumber(v, 'sum()'), 0),
  now: (args, _run, ctx) => (arity('now', args, 0), ctx.now()),
  today: (args, _run, ctx) => {
    arity('today', args, 0);
    const now = ctx.now();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  },
  dateAdd: (args, run) => {
    arity('dateAdd', args, 3);
    return addToDate(
      toDate(run(args[0] as Node), 'dateAdd()'),
      toNumber(run(args[1] as Node), 'dateAdd()'),
      toText(run(args[2] as Node)),
    );
  },
  dateSubtract: (args, run) => {
    arity('dateSubtract', args, 3);
    return addToDate(
      toDate(run(args[0] as Node), 'dateSubtract()'),
      -toNumber(run(args[1] as Node), 'dateSubtract()'),
      toText(run(args[2] as Node)),
    );
  },
  dateBetween: (args, run) => {
    arity('dateBetween', args, 3);
    return between(
      toDate(run(args[0] as Node), 'dateBetween()'),
      toDate(run(args[1] as Node), 'dateBetween()'),
      toText(run(args[2] as Node)),
    );
  },
  formatDate: (args, run) => {
    arity('formatDate', args, 1, 2);
    return formatDate(
      toDate(run(args[0] as Node), 'formatDate()'),
      args[1] ? toText(run(args[1])) : undefined,
    );
  },
  year: (args, run) => (
    arity('year', args, 1), toDate(run(args[0] as Node), 'year()').getUTCFullYear()
  ),
  month: (args, run) => (
    arity('month', args, 1), toDate(run(args[0] as Node), 'month()').getUTCMonth() + 1
  ),
  day: (args, run) => (arity('day', args, 1), toDate(run(args[0] as Node), 'day()').getUTCDate()),
};

function evaluate(node: Node, ctx: FormulaContext): FormulaValue {
  const run = (n: Node) => evaluate(n, ctx);
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'unary': {
      const value = run(node.operand);
      if (node.op === '!') return isEmpty(value);
      if (node.op === '-') return -toNumber(value, 'Negating');
      return toNumber(value, 'Plus');
    }
    case 'call': {
      // Own names only: `constructor` or `__proto__` must not reach Object's.
      const fn = Object.hasOwn(FUNCTIONS, node.name) ? FUNCTIONS[node.name] : undefined;
      if (!fn) throw new FormulaError(`Unknown function "${node.name}"`);
      return fn(node.args, run, ctx);
    }
    case 'binary': {
      if (node.op === 'and') return !isEmpty(run(node.left)) && !isEmpty(run(node.right));
      if (node.op === 'or') return !isEmpty(run(node.left)) || !isEmpty(run(node.right));
      const left = run(node.left);
      const right = run(node.right);
      switch (node.op) {
        case '+':
          if (typeof left === 'string' || typeof right === 'string')
            return text(toText(left) + toText(right));
          return toNumber(left, 'Adding') + toNumber(right, 'Adding');
        case '-':
          return toNumber(left, 'Subtracting') - toNumber(right, 'Subtracting');
        case '*':
          return toNumber(left, 'Multiplying') * toNumber(right, 'Multiplying');
        case '/': {
          const divisor = toNumber(right, 'Dividing');
          if (divisor === 0) throw new FormulaError('Division by zero');
          return toNumber(left, 'Dividing') / divisor;
        }
        case '%': {
          const divisor = toNumber(right, 'Modulo');
          if (divisor === 0) throw new FormulaError('Division by zero');
          return toNumber(left, 'Modulo') % divisor;
        }
        case '^':
          return toNumber(left, 'Power') ** toNumber(right, 'Power');
        case '==':
          return equal(left, right);
        case '!=':
          return !equal(left, right);
        case '>':
          return compare(left, right) > 0;
        case '>=':
          return compare(left, right) >= 0;
        case '<':
          return compare(left, right) < 0;
        case '<=':
          return compare(left, right) <= 0;
      }
    }
  }
  throw new FormulaError('Cannot evaluate the formula');
}

/** Evaluate `expression` against `ctx`: its value, or null and why. */
export function evaluateFormula(
  expression: string,
  ctx: FormulaContext,
): { value: FormulaValue; error: string | null } {
  const source = (expression ?? '').trim().replace(/^=/, '').trim();
  if (!source) return { value: null, error: null };
  if (source.length > MAX_SOURCE) return { value: null, error: 'The formula is too long' };
  try {
    const value = evaluate(parse(source), ctx);
    if (typeof value === 'number' && !Number.isFinite(value))
      return { value: null, error: 'The result is not a number' };
    return { value, error: null };
  } catch (err: unknown) {
    if (err instanceof FormulaError) return { value: null, error: err.message };
    if (err instanceof RangeError) return { value: null, error: 'The formula is too complex' };
    throw err;
  }
}

/** A formula with no properties to read (the old constant-only evaluator's contract). */
export function evaluateFormulaExpression(expression: string): number | string | null {
  const { value } = evaluateFormula(expression, {
    prop: () => {
      throw new FormulaError('No row to read properties from');
    },
    now: () => new Date(),
  });
  return typeof value === 'number' || typeof value === 'string'
    ? value
    : value === null
      ? null
      : toText(value);
}

/** How a formula's value is stored beside the row's other values. */
export function formulaCellValue(
  value: FormulaValue,
  error: string | null,
): Record<string, unknown> {
  if (error) return { text: '', error };
  if (typeof value === 'number') return { number: value };
  if (typeof value === 'boolean') return { checked: value };
  if (value instanceof Date) return { start: value.toISOString() };
  return { text: toText(value) };
}
