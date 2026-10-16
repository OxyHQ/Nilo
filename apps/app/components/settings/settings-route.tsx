import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useNiloSettings, type SettingsPage } from './settings-provider';

/** Keeps settings links working: opens the settings dialog over the workspace. */
export function SettingsRoute({ page }: { page: SettingsPage }) {
  const router = useRouter();
  const { open } = useNiloSettings();
  useEffect(() => {
    open(page);
    router.replace('/(app)');
  }, [open, page, router]);
  return null;
}
