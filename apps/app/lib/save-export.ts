import { Platform } from 'react-native';
import { Directory } from 'expo-file-system';

/** One export flow; only the operating system's file destination differs. */
export async function saveExport({
  blob,
  filename,
}: {
  blob: Blob;
  filename: string;
}): Promise<void> {
  if (Platform.OS === 'web') {
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    try {
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    }
    return;
  }
  const directory = await Directory.pickDirectoryAsync();
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
  const file = directory.createFile(filename, blob.type || null);
  await file.write(base64, { encoding: 'base64' });
}
