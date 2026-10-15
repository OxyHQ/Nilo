import {
  formFields,
  parseFormDate,
  retryAfterSeconds,
  serializeForm,
  type FormField,
  type FormFieldType,
} from '../forms';
const field = (id: string, type: FormFieldType): FormField => ({
  id,
  name: id,
  type,
  required: id === 'name',
  options: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ],
});

it('serializes all supported input types into database row values, omitting hidden answers', () => {
  const fields = [
    field('name', 'text'),
    field('count', 'number'),
    field('choice', 'select'),
    field('status', 'status'),
    field('multi', 'multi_select'),
    field('day', 'date'),
    field('done', 'checkbox'),
    field('url', 'url'),
    field('email', 'email'),
    field('phone', 'phone'),
  ];
  expect(
    serializeForm(fields, {
      name: ' First ',
      count: '0',
      choice: 'a',
      status: 'b',
      multi: ['a', 'b'],
      day: '2024-02-29',
      done: false,
      url: 'https://example.com',
      email: 'a@example.com',
      phone: '+40 123',
      hidden: 'never send',
    }),
  ).toEqual({
    errors: {},
    values: {
      name: { text: 'First' },
      count: { number: 0 },
      choice: { optionId: 'a' },
      status: { optionId: 'b' },
      multi: { optionIds: ['a', 'b'] },
      day: { start: '2024-02-29', includeTime: false },
      done: { checked: false },
      url: { value: 'https://example.com' },
      email: { value: 'a@example.com' },
      phone: { value: '+40 123' },
    },
  });
});
it('rejects missing names, invalid numbers, stale options and unsafe URLs', () => {
  expect(
    serializeForm(
      [
        field('name', 'text'),
        field('n', 'number'),
        field('s', 'select'),
        field('m', 'multi_select'),
        field('u', 'url'),
        field('e', 'email'),
      ],
      {
        name: ' ',
        n: 'Infinity',
        s: 'unknown',
        m: ['unknown'],
        u: 'javascript:alert(1)',
        e: 'invalid',
      },
    ).errors,
  ).toEqual({
    name: 'required',
    n: 'invalid',
    s: 'invalid',
    m: 'invalid',
    u: 'invalid',
    e: 'invalid',
  });
});
it('allows past dates but rejects rolled over dates and orphan times', () => {
  expect(parseFormDate('2024-02-29', '')).toBe('2024-02-29');
  expect(parseFormDate('2025-02-29', '')).toBeNull();
  expect(parseFormDate('2026-01-01', '24:00')).toBeNull();
  expect(parseFormDate('2020-01-01', '12:30')).toBe(new Date(2020, 0, 1, 12, 30).toISOString());
  expect(serializeForm([field('date', 'date')], { 'date:time': '12:30' }).errors).toEqual({
    date: 'invalid',
  });
});
it('previews only supported, visible properties with the required Name field', () => {
  expect(
    formFields(
      [
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'hidden', name: 'Hidden', type: 'number' },
        { id: 'computed', name: 'Computed', type: 'formula' },
      ],
      ['hidden'],
    ),
  ).toEqual([{ id: 'name', name: 'Name', type: 'text', required: true, options: undefined }]);
});
it('honors both forms of Retry-After and uses a bounded retry delay for malformed headers', () => {
  expect(retryAfterSeconds('120')).toBe(120);
  expect(
    retryAfterSeconds('Thu, 15 Oct 2026 12:01:30 GMT', Date.parse('2026-10-15T12:00:00Z')),
  ).toBe(90);
  expect(retryAfterSeconds('invalid')).toBe(60);
  expect(retryAfterSeconds('-1')).toBe(1);
});
