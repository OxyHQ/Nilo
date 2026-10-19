import { Directory, File, Paths } from 'expo-file-system';
import type { OfflineFiles } from './offline-files';

const folder = () => new Directory(Paths.document, 'nilo-offline');

/**
 * Offline copies as files in the app's documents: no size cap but the
 * device's, kept across launches, and each written whole (a temporary file
 * renamed over the old one) so a copy is never half a page.
 */
export const offlineFiles: OfflineFiles = {
  async read(name) {
    const file = new File(folder(), name);
    return file.exists ? file.text() : null;
  },
  async write(name, text) {
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true });
    const temporary = new File(dir, `${name}.tmp`);
    await temporary.write(text);
    temporary.moveSync(new File(dir, name), { overwrite: true });
  },
  async remove(name) {
    const file = new File(folder(), name);
    if (file.exists) file.delete();
  },
  async clear() {
    const dir = folder();
    if (dir.exists) dir.delete();
  },
};
