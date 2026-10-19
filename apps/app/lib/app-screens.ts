/**
 * Every screen of the signed-in workspace shell (`app/(app)/`), by its route
 * name. Since Expo Router 58 a Drawer renders only the screens its layout
 * declares, so `app/(app)/_layout.tsx` declares each of these: a route file
 * missing here would be blank. `lib/__tests__/app-screens.test.ts` holds this
 * list to the files.
 */
export const APP_SCREENS = [
  'index',
  'notifications',
  'trash',
  'p/[pageId]',
  'db/[id]',
  'settings/index',
  'settings/general',
  'settings/workspace',
  'settings/members',
  'settings/offline',
  'settings/feedback',
] as const;
