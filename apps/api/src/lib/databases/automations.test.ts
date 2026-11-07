import { createHmac } from 'node:crypto';
import {
  type AutomationTrigger,
  automationInputSchema,
  triggerFires,
} from '@oxy.so/nilo-contracts';
import { describe, expect, it } from 'vitest';
import { signWebhook } from './automations.js';

const event = (
  created: boolean,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) => ({ created, before, after });

describe('triggerFires', () => {
  const added: AutomationTrigger = { kind: 'row_added' };
  const edited: AutomationTrigger = { kind: 'property_edited', propertyId: 'status' };
  const becomes: AutomationTrigger = {
    kind: 'property_edited',
    propertyId: 'status',
    equals: { optionId: 'done' },
  };

  it('fires row_added for a new row only', () => {
    expect(triggerFires(added, event(true, {}, {}))).toBe(true);
    expect(triggerFires(added, event(false, {}, { status: { optionId: 'a' } }))).toBe(false);
  });

  it('fires property_edited when the property changed, not for a new row or another property', () => {
    const change = event(false, { status: { optionId: 'a' } }, { status: { optionId: 'b' } });
    expect(triggerFires(edited, change)).toBe(true);
    expect(triggerFires(edited, event(true, {}, { status: { optionId: 'b' } }))).toBe(false);
    expect(triggerFires(edited, event(false, { other: 1 }, { other: 2 }))).toBe(false);
  });

  it('does not fire when the write left the property as it was', () => {
    const same = { status: { optionId: 'a' } };
    expect(triggerFires(edited, event(false, same, { ...same, other: 1 }))).toBe(false);
  });

  it('with equals, fires only when the property becomes exactly that value', () => {
    expect(
      triggerFires(
        becomes,
        event(false, { status: { optionId: 'a' } }, { status: { optionId: 'done' } }),
      ),
    ).toBe(true);
    expect(
      triggerFires(
        becomes,
        event(false, { status: { optionId: 'a' } }, { status: { optionId: 'b' } }),
      ),
    ).toBe(false);
  });

  it('reads a property that was never set as null on both sides', () => {
    expect(triggerFires(edited, event(false, {}, { status: null }))).toBe(false);
    expect(triggerFires(edited, event(false, {}, { status: { optionId: 'a' } }))).toBe(true);
  });
});

describe('automationInputSchema', () => {
  const valid = {
    name: 'Done',
    trigger: { kind: 'row_added' },
    actions: [{ kind: 'webhook', url: 'https://example.com/hook' }],
  };

  it('accepts a trigger and actions', () => {
    expect(automationInputSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses no actions, too many, and unknown keys', () => {
    expect(automationInputSchema.safeParse({ ...valid, actions: [] }).success).toBe(false);
    const six = Array.from({ length: 6 }, () => valid.actions[0]);
    expect(automationInputSchema.safeParse({ ...valid, actions: six }).success).toBe(false);
    expect(automationInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });

  it('refuses a webhook that is not https, and a notify with nobody to tell', () => {
    const webhook = { ...valid, actions: [{ kind: 'webhook', url: 'http://example.com' }] };
    expect(automationInputSchema.safeParse(webhook).success).toBe(false);
    const notify = {
      ...valid,
      actions: [{ kind: 'notify', to: { kind: 'people', userIds: [] } }],
    };
    expect(automationInputSchema.safeParse(notify).success).toBe(false);
  });
});

describe('signWebhook', () => {
  it('signs "t.body" with the secret so a receiver can verify it', () => {
    const at = new Date('2026-11-07T12:00:00Z');
    const t = Math.floor(at.getTime() / 1000);
    const expected = createHmac('sha256', 'secret').update(`${t}.{"a":1}`).digest('hex');
    expect(signWebhook('secret', '{"a":1}', at)).toBe(`t=${t},v1=${expected}`);
    expect(signWebhook('other', '{"a":1}', at)).not.toBe(signWebhook('secret', '{"a":1}', at));
  });
});
