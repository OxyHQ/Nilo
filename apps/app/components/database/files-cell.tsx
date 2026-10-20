import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { RiAddLine } from '@oxy.so/bloom/icons/RiAddLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { RiFileLine } from '@oxy.so/bloom/icons/RiFileLine';
import { RiUpload2Line } from '@oxy.so/bloom/icons/RiUpload2Line';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { Popover, PopoverContent, PopoverTrigger } from '@oxy.so/bloom/popover';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import * as WebBrowser from 'expo-web-browser';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import type { FileUrlScope } from '@oxy.so/nilo-contracts';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';
import { freshFileUrl, isFileRemoved, useFileScope } from '@/lib/files/file-urls';
import { FileTooLargeError } from '@/lib/files/upload-page-file';
import { useMediaUpload } from '@/components/editor/blocks/media-upload';
import type { FileEntry } from '@/lib/types/databases';

/** Where `file` opens: a link as it is, a file in Oxy storage through a URL minted now. */
async function fileTarget(
  queryClient: QueryClient,
  scope: FileUrlScope | null,
  file: FileEntry,
): Promise<string | null> {
  if (file.fileId) return scope ? freshFileUrl(queryClient, scope, file.fileId) : null;
  return file.url ?? null;
}

async function openTarget(target: string): Promise<void> {
  if (Platform.OS === 'web') window.open(target, '_blank', 'noopener,noreferrer');
  else await WebBrowser.openBrowserAsync(target);
}

/** A file's chip; pressing it opens the file. */
function useOpenFile(rowId: string | undefined) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const scope = useFileScope(rowId);
  const [error, setError] = React.useState<string | null>(null);
  const open = async (file: FileEntry) => {
    setError(null);
    try {
      const target = await fileTarget(queryClient, scope, file);
      if (target) {
        await openTarget(target);
        return;
      }
      setError(
        file.fileId && scope && isFileRemoved(queryClient, scope, file.fileId)
          ? t('editor.blocks.file.removed')
          : t('editor.blocks.file.unavailable'),
      );
    } catch {
      setError(t('editor.blocks.file.unavailable'));
    }
  };
  return { open, error };
}

const fileKey = (file: FileEntry, index: number) => file.fileId ?? file.url ?? String(index);

/**
 * A files property's files, as chips that open them. `rowId`, the row's page,
 * is whom a file in Oxy storage is asked for (its URL is minted for readers
 * of that page); without it such a file is listed but cannot be opened.
 */
export function FilesChips({ value, rowId }: { value: FileEntry[]; rowId?: string }) {
  const { open, error } = useOpenFile(rowId);
  if (value.length === 0) return <Text className="text-sm text-muted-foreground">—</Text>;
  return (
    <View className="gap-1">
      <View className="flex-row flex-wrap gap-1">
        {value.slice(0, 3).map((file, index) => (
          <Chip
            key={fileKey(file, index)}
            size="sm"
            // The cell or card around the chip opens the row or the editor.
            stopPropagation
            accessibilityLabel={file.name}
            onPress={() => void open(file)}
          >
            {file.name}
          </Chip>
        ))}
        {value.length > 3 ? (
          <Text className="text-xs text-muted-foreground">+{value.length - 3}</Text>
        ) : null}
      </View>
      {error ? <Text className="text-xs text-destructive">{error}</Text> : null}
    </View>
  );
}

interface FilesCellProps {
  value: FileEntry[];
  rowId?: string;
  label: string;
  variant: 'table' | 'panel' | 'card';
  onChange: (files: FileEntry[]) => void;
}

/**
 * A files property: its files, and an editor to open, remove, upload (to the
 * row's page in Oxy storage, `uploadPageFile`) or link one.
 */
export function FilesCell({ value, rowId, label, variant, onChange }: FilesCellProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          className={`flex-row items-center gap-1 ${variant === 'table' ? 'py-0.5' : 'py-1'}`}
        >
          {value.length === 0 ? (
            <RiFileLine width={14} height={14} fill={colors.mutedForeground} />
          ) : null}
          <FilesChips value={value} rowId={rowId} />
        </Pressable>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        minWidth={300}
        label={t('databases.files.title')}
        className="gap-2"
      >
        {open ? <FilesEditor value={value} rowId={rowId} onChange={onChange} /> : null}
      </PopoverContent>
    </Popover>
  );
}

/** What a typed link is called when it is given no name: the last part of its path. */
export function linkName(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : parsed.hostname;
  } catch {
    return url;
  }
}

/** A typed link as the API keeps one: absolute, `https://` when no scheme was typed. */
export function normalizeLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(withScheme);
    return withScheme;
  } catch {
    return null;
  }
}

function FilesEditor({
  value,
  rowId,
  onChange,
}: {
  value: FileEntry[];
  rowId?: string;
  onChange: (files: FileEntry[]) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const { open, error: openError } = useOpenFile(rowId);
  const [link, setLink] = React.useState('');
  // The value as the last write left it: two uploads in a row both stay.
  const latest = React.useRef(value);
  latest.current = value;

  const upload = useMediaUpload(
    rowId,
    'file',
    (attached) => {
      const next = [...latest.current, { fileId: attached.fileId, name: attached.name }];
      latest.current = next;
      onChange(next);
    },
    (err) =>
      err instanceof FileTooLargeError
        ? t('databases.files.tooLarge')
        : t('editor.blocks.uploadFailed'),
  );
  // A link's error shows where an upload's does, the last one replacing the one before.
  const { error, setError } = upload;

  const addLink = () => {
    const url = normalizeLink(link);
    if (!url) {
      setError(t('databases.files.invalidLink'));
      return;
    }
    setError(null);
    setLink('');
    onChange([...value, { url, name: linkName(url) }]);
  };

  return (
    <>
      {value.length === 0 ? (
        <Text className="py-1 text-sm text-muted-foreground">{t('databases.files.empty')}</Text>
      ) : (
        value.map((file, index) => (
          <View key={fileKey(file, index)} className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={file.name}
              className="flex-1 flex-row items-center gap-2 py-1"
              onPress={() => void open(file)}
            >
              <RiFileLine width={14} height={14} fill={colors.foreground} />
              <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
                {file.name}
              </Text>
            </Pressable>
            <Button
              iconOnly
              appearance="plain"
              size="xs"
              accessibilityLabel={t('databases.files.remove', { name: file.name })}
              onPress={() => onChange(value.filter((_, i) => i !== index))}
              leadingIcon={RiDeleteBin6Line}
            />
          </View>
        ))
      )}
      {rowId ? (
        <Button
          appearance="subtle"
          size="sm"
          className="self-start"
          disabled={upload.busy}
          onPress={upload.choose}
          leadingIcon={RiUpload2Line}
        >
          {upload.busy ? t('editor.blocks.uploading') : t('databases.files.upload')}
        </Button>
      ) : null}
      {rowId ? upload.input : null}
      <View className="flex-row items-end gap-2">
        <View className="flex-1">
          <TextFieldInput
            size="sm"
            label={t('databases.files.link')}
            value={link}
            onChangeText={setLink}
            onSubmitEditing={addLink}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Button
          appearance="plain"
          size="sm"
          disabled={!link.trim()}
          onPress={addLink}
          leadingIcon={RiAddLine}
        >
          {t('databases.files.addLink')}
        </Button>
      </View>
      {error || openError ? (
        <Text accessibilityRole="alert" className="text-xs text-destructive">
          {error ?? openError}
        </Text>
      ) : null}
    </>
  );
}
