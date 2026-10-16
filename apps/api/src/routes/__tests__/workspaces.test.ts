import { describe, it, expect } from 'vitest';
import { compareRoles, hasRole, WORKSPACE_ROLES } from '../../db/schema/workspaces.js';
import { createWorkspaceSchema, updateWorkspaceSchema } from '../../lib/workspace-input.js';

describe('workspace role helpers', () => {
  it('orders roles viewer < commenter < editor < admin < owner', () => {
    expect(WORKSPACE_ROLES).toEqual(['viewer', 'commenter', 'editor', 'admin', 'owner']);
  });

  it('compareRoles returns negative when a < b', () => {
    expect(compareRoles('viewer', 'editor')).toBeLessThan(0);
    expect(compareRoles('editor', 'owner')).toBeLessThan(0);
  });

  it('compareRoles returns zero on equality', () => {
    expect(compareRoles('editor', 'editor')).toBe(0);
    expect(compareRoles('owner', 'owner')).toBe(0);
  });

  it('compareRoles returns positive when a > b', () => {
    expect(compareRoles('owner', 'admin')).toBeGreaterThan(0);
    expect(compareRoles('admin', 'commenter')).toBeGreaterThan(0);
  });

  it('hasRole grants higher roles all lower privileges', () => {
    expect(hasRole('owner', 'viewer')).toBe(true);
    expect(hasRole('admin', 'editor')).toBe(true);
    expect(hasRole('editor', 'commenter')).toBe(true);
    expect(hasRole('commenter', 'viewer')).toBe(true);
  });

  it('hasRole denies escalation', () => {
    expect(hasRole('viewer', 'commenter')).toBe(false);
    expect(hasRole('editor', 'admin')).toBe(false);
    expect(hasRole('admin', 'owner')).toBe(false);
  });

  it('hasRole accepts equal roles', () => {
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('viewer', 'viewer')).toBe(true);
  });
});

describe('workspace input validation', () => {
  const OBJECT_ID = '65fdc8c8c8c8c8c8c8c8c8c8';
  const UUID = '01a0821e-d61a-7a78-b5d1-afb1850bd5a4';

  it('accepts a minimal valid body', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'Team' }).success).toBe(true);
  });

  it('rejects empty names', () => {
    expect(createWorkspaceSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('rejects overlong names', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('accepts an Oxy file id as the avatar, in either shape', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'X', avatar: OBJECT_ID }).success).toBe(true);
    expect(createWorkspaceSchema.safeParse({ name: 'X', avatar: UUID }).success).toBe(true);
  });

  it('allows a null or omitted avatar', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'X', avatar: null }).success).toBe(true);
    expect(createWorkspaceSchema.safeParse({ name: 'X' }).success).toBe(true);
  });

  it('rejects an emoji or a URL as the avatar', () => {
    expect(createWorkspaceSchema.safeParse({ name: 'X', avatar: '🚀' }).success).toBe(false);
    expect(
      createWorkspaceSchema.safeParse({ name: 'X', avatar: `https://cdn.example/${OBJECT_ID}` })
        .success,
    ).toBe(false);
  });

  it('requires a patch to change something', () => {
    expect(updateWorkspaceSchema.safeParse({}).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ avatar: null }).success).toBe(true);
    expect(updateWorkspaceSchema.safeParse({ name: 'Renamed' }).success).toBe(true);
  });
});

describe('share link token generation', () => {
  it('generates base64url tokens of expected length', async () => {
    const crypto = await import('node:crypto');
    const token = crypto.randomBytes(24).toString('base64url');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // base64url(24 bytes) = 32 chars (no padding)
    expect(token.length).toBe(32);
  });
});
