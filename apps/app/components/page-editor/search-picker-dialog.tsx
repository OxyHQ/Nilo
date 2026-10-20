import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Dialog, useDialogControl } from '@oxy.so/bloom/dialog';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { Loading } from '@oxy.so/bloom/loading';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { normalizeMentionQuery } from './mention-search';

/**
 * Whether `label` matches what was typed, as every picker and mention search
 * reads it: case and accents aside (`normalizeMentionQuery`).
 */
export function matchesSearch(label: string, search: string): boolean {
  return normalizeMentionQuery(label).includes(normalizeMentionQuery(search));
}

/**
 * A dialog that picks one thing from a list searched as it is typed: the
 * search field, the list's loading and failure, its choices, and an empty
 * state. `children` draws the choices; the `choose` it is handed closes the
 * dialog, then acts on the choice.
 */
export function SearchPickerDialog({
  title,
  searchLabel,
  search,
  onSearch,
  loading,
  failure,
  empty,
  onClose,
  children,
}: {
  title: string;
  /** The search field's label and placeholder. */
  searchLabel: string;
  search: string;
  onSearch: (next: string) => void;
  loading: boolean;
  /** When the list could not be read: what to say, and a retry. */
  failure?: { message: string; retry: string; onRetry: () => void } | null;
  /** What to say when there is nothing to choose; null while there is. */
  empty: string | null;
  onClose: () => void;
  children: (choose: (then: () => void) => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const control = useDialogControl();
  return (
    <Dialog
      control={control}
      startOpen
      onClose={onClose}
      placement={{ base: 'bottom', md: 'center' }}
      title={title}
    >
      <View className="gap-3">
        <TextFieldInput
          value={search}
          onChangeText={onSearch}
          autoFocus
          label={searchLabel}
          placeholder={searchLabel}
        />
        {loading ? <Loading variant="inline" text={t('common.loading')} /> : null}
        {failure ? (
          <>
            <Text variant="body-regular" accessibilityRole="alert">
              {failure.message}
            </Text>
            <Button appearance="outline" tone="neutral" onPress={failure.onRetry}>
              {failure.retry}
            </Button>
          </>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled">
          {children((then) => control.close(then))}
          {empty !== null ? <EmptyState variant="compact" title={empty} /> : null}
        </ScrollView>
      </View>
    </Dialog>
  );
}
