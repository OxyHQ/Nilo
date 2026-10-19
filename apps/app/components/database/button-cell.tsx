import * as React from 'react';
import { Linking } from 'react-native';
import { RiCursorLine } from '@oxy.so/bloom/icons/RiCursorLine';
import { Button } from '@oxy.so/bloom/button';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from '@/hooks/useTranslation';
import { runButtonActions } from '@/lib/button-actions';
import { useCreateRow, useUpdateRow } from '@/lib/hooks/use-database-rows';
import type { DatabaseProperty } from '@/lib/types/databases';
import { useDatabaseCellScope } from './cell-scope';

interface ButtonCellProps {
  property: DatabaseProperty;
  /** The row the button is in: the one its "edit a property" actions write. */
  rowId?: string;
  readOnly?: boolean;
}

/**
 * A button property's cell: a button named as the property that runs its
 * actions (`config.actions`) when pressed — opens a link, sets values of its
 * row, adds a row — as Notion's buttons do. A reader sees it, not presses it.
 */
export function ButtonCell({ property, rowId, readOnly = false }: ButtonCellProps) {
  const { t } = useTranslation();
  const scope = useDatabaseCellScope();
  const updateRow = useUpdateRow();
  const createRow = useCreateRow();
  const [running, setRunning] = React.useState(false);
  const actions = property.config?.actions ?? [];
  const databaseId = scope?.databaseId;

  const run = async () => {
    if (!databaseId || !rowId || actions.length === 0) return;
    setRunning(true);
    try {
      await runButtonActions(actions, databaseId, {
        openUrl: (url) => Linking.openURL(url),
        setProperties: (properties) => updateRow.mutateAsync({ databaseId, rowId, properties }),
        createRow: (target, title) =>
          createRow.mutateAsync({ databaseId: target, ...(title && { title }) }),
      });
    } catch {
      toast.error(t('databases.button.failed'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Button
      appearance="subtle"
      size="xs"
      className="self-start"
      // The row around the cell opens the row.
      stopPropagation
      leadingIcon={RiCursorLine}
      disabled={readOnly || running || actions.length === 0 || !rowId}
      accessibilityLabel={running ? t('databases.button.running') : property.name}
      onPress={() => void run()}
    >
      {property.name}
    </Button>
  );
}
