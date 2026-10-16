import { z } from 'zod';
import { WORKSPACE_NAME_MAX } from '../db/schema/workspaces.js';

/**
 * A workspace picture is a bare Oxy file id — a 24-hex object id or a UUID —
 * never a URL: the app resolves it through Oxy's public asset URL, so storing a
 * URL would pin one host and one variant. `null` clears it.
 */
const avatarSchema = z
  .string()
  .regex(/^(?:[0-9a-f]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  .nullable()
  .optional();

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX),
  avatar: avatarSchema,
});

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX).optional(),
    avatar: avatarSchema,
  })
  .refine((val) => val.name !== undefined || val.avatar !== undefined, {
    message: 'Provide at least one of: name, avatar',
  });
