import * as React from 'react';
import type { DialogControlProps } from '@oxy.so/bloom/dialog';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdateDatabase } from '@/lib/hooks/use-databases';
import { CoverPicker } from '@/components/page-chrome/cover-picker';
import { IconPicker } from '@/components/page-chrome/icon-picker';

interface DatabaseChromePickersProps {
  databaseId: string;
  iconControl: DialogControlProps;
  coverControl: DialogControlProps;
}

/**
 * A database's icon and cover pickers, the page's own (`page-chrome`): the
 * same emoji, icons, gradients, colours and images, stored the same way, so
 * `IconDisplay` and `CoverDisplay` show them wherever the database appears.
 */
export function DatabaseChromePickers({
  databaseId,
  iconControl,
  coverControl,
}: DatabaseChromePickersProps) {
  const { t } = useTranslation();
  const updateDatabase = useUpdateDatabase();
  const save = React.useCallback(
    (patch: { icon?: string | null; cover?: string | null }) =>
      updateDatabase.mutate(
        { id: databaseId, ...patch },
        { onError: () => toast.error(t('databases.chrome.saveFailed')) },
      ),
    [databaseId, updateDatabase, t],
  );
  return (
    <>
      <IconPicker control={iconControl} onSelect={(icon) => save({ icon })} />
      <CoverPicker control={coverControl} onSelect={(cover) => save({ cover })} />
    </>
  );
}
