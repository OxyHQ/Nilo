import { Platform } from 'react-native';
import { saveExport } from '../save-export';

const mockWrite = jest.fn();
const mockCreateFile = jest.fn(() => ({ write: mockWrite }));
const mockPickDirectory = jest.fn(async () => ({ createFile: mockCreateFile }));
jest.mock('expo-file-system', () => ({
  Directory: { pickDirectoryAsync: () => mockPickDirectory() },
}));
const originalOS = Platform.OS;
const originalReader = global.FileReader;
afterEach(() => {
  Platform.OS = originalOS;
  global.FileReader = originalReader;
  jest.clearAllMocks();
});

it.each(['android', 'ios'] as const)(
  'saves export bytes through the selected %s directory',
  async (platform) => {
    Platform.OS = platform;
    const blob = new Blob(['Name\nCafé'], { type: 'text/csv' });
    class Reader {
      result = 'data:text/csv;base64,TmFtZQpDYWbDqQ==';
      onload?: () => void;
      readAsDataURL(input: Blob) {
        expect(input).toBe(blob);
        this.onload?.();
      }
    }
    global.FileReader = Reader as unknown as typeof FileReader;
    await saveExport({ blob, filename: 'Café.csv' });
    expect(mockPickDirectory).toHaveBeenCalledTimes(1);
    expect(mockCreateFile).toHaveBeenCalledWith('Café.csv', 'text/csv');
    expect(mockWrite).toHaveBeenCalledWith('TmFtZQpDYWbDqQ==', { encoding: 'base64' });
  },
);
