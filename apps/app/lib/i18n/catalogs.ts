/**
 * Every translation catalog, one JSON file per namespace and language.
 * A namespace is registered here once; its keys live in `locales/<lang>/<ns>.json`
 * and `__tests__/catalogs.test.ts` keeps both languages and the code in step.
 */
import enAi from './locales/en/ai.json';
import enAlia from './locales/en/alia.json';
import enCommandPalette from './locales/en/commandPalette.json';
import enComments from './locales/en/comments.json';
import enCommon from './locales/en/common.json';
import enDatabases from './locales/en/databases.json';
import enEditor from './locales/en/editor.json';
import enErrors from './locales/en/errors.json';
import enFeedback from './locales/en/feedback.json';
import enHome from './locales/en/home.json';
import enKeyboardShortcuts from './locales/en/keyboardShortcuts.json';
import enLogin from './locales/en/login.json';
import enNav from './locales/en/nav.json';
import enNotifications from './locales/en/notifications.json';
import enPages from './locales/en/pages.json';
import enSettings from './locales/en/settings.json';
import enSharing from './locales/en/sharing.json';
import enSidebar from './locales/en/sidebar.json';
import enTrash from './locales/en/trash.json';
import enWelcome from './locales/en/welcome.json';
import enWorkspace from './locales/en/workspace.json';
import esAi from './locales/es/ai.json';
import esAlia from './locales/es/alia.json';
import esCommandPalette from './locales/es/commandPalette.json';
import esComments from './locales/es/comments.json';
import esCommon from './locales/es/common.json';
import esDatabases from './locales/es/databases.json';
import esEditor from './locales/es/editor.json';
import esErrors from './locales/es/errors.json';
import esFeedback from './locales/es/feedback.json';
import esHome from './locales/es/home.json';
import esKeyboardShortcuts from './locales/es/keyboardShortcuts.json';
import esLogin from './locales/es/login.json';
import esNav from './locales/es/nav.json';
import esNotifications from './locales/es/notifications.json';
import esPages from './locales/es/pages.json';
import esSettings from './locales/es/settings.json';
import esSharing from './locales/es/sharing.json';
import esSidebar from './locales/es/sidebar.json';
import esTrash from './locales/es/trash.json';
import esWelcome from './locales/es/welcome.json';
import esWorkspace from './locales/es/workspace.json';

export const en = {
  ai: enAi,
  alia: enAlia,
  commandPalette: enCommandPalette,
  comments: enComments,
  common: enCommon,
  databases: enDatabases,
  editor: enEditor,
  errors: enErrors,
  feedback: enFeedback,
  home: enHome,
  keyboardShortcuts: enKeyboardShortcuts,
  login: enLogin,
  nav: enNav,
  notifications: enNotifications,
  pages: enPages,
  settings: enSettings,
  sharing: enSharing,
  sidebar: enSidebar,
  trash: enTrash,
  welcome: enWelcome,
  workspace: enWorkspace,
};

export const es = {
  ai: esAi,
  alia: esAlia,
  commandPalette: esCommandPalette,
  comments: esComments,
  common: esCommon,
  databases: esDatabases,
  editor: esEditor,
  errors: esErrors,
  feedback: esFeedback,
  home: esHome,
  keyboardShortcuts: esKeyboardShortcuts,
  login: esLogin,
  nav: esNav,
  notifications: esNotifications,
  pages: esPages,
  settings: esSettings,
  sharing: esSharing,
  sidebar: esSidebar,
  trash: esTrash,
  welcome: esWelcome,
  workspace: esWorkspace,
};
