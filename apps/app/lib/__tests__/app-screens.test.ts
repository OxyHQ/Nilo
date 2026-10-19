import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { APP_SCREENS } from '../app-screens';

const SHELL = join(__dirname, '..', '..', 'app', '(app)');

/** Route names of every screen file under app/(app), as Expo Router names them. */
function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    if (!/\.tsx?$/.test(entry.name) || /^(_layout|\+)/.test(entry.name)) return [];
    return [relative(SHELL, path).replace(/\.tsx?$/, '')];
  });
}

describe('the workspace shell declares every screen', () => {
  it('lists exactly the screen files of app/(app)', () => {
    expect([...APP_SCREENS].sort()).toEqual(routeFiles(SHELL).sort());
  });
});
