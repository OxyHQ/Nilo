import * as React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Popover, PopoverContent } from '@oxy.so/bloom/popover';
import { TextField, TextFieldInput } from '@oxy.so/bloom/text-field';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';

interface IdentityPopoverProps {
  children: React.ReactNode;
  title: string;
  icon: React.ReactNode;
  onSave: (title: string) => Promise<unknown>;
  onChooseIcon: () => void;
}

/** Product metadata form. Bloom owns its trigger, placement, surface and focus. */
export function IdentityPopover({
  children,
  title,
  icon,
  onSave,
  onChooseIcon,
}: IdentityPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const openRef = React.useRef(false);
  const [draft, setDraft] = React.useState(title);
  const [failed, setFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const draftRef = React.useRef(title);
  const savedRef = React.useRef(title);
  const pendingRef = React.useRef<Promise<boolean> | null>(null);
  const failedRef = React.useRef(false);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (saving || pendingRef.current || failedRef.current) return;
    // A remote rename can update an untouched field, but never replace a draft.
    if (draftRef.current === savedRef.current) {
      draftRef.current = title;
      setDraft(title);
    }
    savedRef.current = title;
  }, [title, saving]);

  const save = (): Promise<boolean> => {
    if (!mounted.current) return Promise.resolve(false);
    if (pendingRef.current) return pendingRef.current;
    if (!failedRef.current && draftRef.current === savedRef.current) return Promise.resolve(true);
    const next = draftRef.current;
    setSaving(true);
    setFailed(false);
    const pending = Promise.resolve()
      .then(async () => {
        if (!mounted.current) return false;
        await onSave(next);
        return true;
      })
      .then(
        (saved) => {
          if (mounted.current && saved) {
            savedRef.current = next;
            failedRef.current = false;
          }
          return saved;
        },
        () => {
          if (mounted.current) {
            failedRef.current = true;
            setFailed(true);
          }
          return false;
        },
      )
      .finally(() => {
        pendingRef.current = null;
        if (mounted.current) setSaving(false);
      });
    pendingRef.current = pending;
    return pending;
  };

  const finishClose = () => {
    if (!mounted.current || !openRef.current) return false;
    openRef.current = false;
    setOpen(false);
    return true;
  };

  const close = async () => {
    if (await save()) finishClose();
  };

  const handleEscape = (event: {
    nativeEvent: { key: string };
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    if (event.nativeEvent.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    // A request already sent cannot be cancelled by dismissing its UI.
    if (pendingRef.current) return;
    draftRef.current = savedRef.current;
    setDraft(savedRef.current);
    finishClose();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          if (openRef.current) return;
          openRef.current = true;
          draftRef.current = title;
          savedRef.current = title;
          setDraft(title);
          setFailed(false);
          failedRef.current = false;
          setOpen(true);
        } else {
          void close();
        }
      }}
    >
      {children}
      <PopoverContent align="start" label={t('pages.header.rename')} maxWidth={380}>
        <View className="flex-row items-center gap-2">
          <Button
            iconOnly
            appearance="plain"
            accessibilityLabel={t('pages.header.changeIcon')}
            disabled={saving}
            onKeyDown={handleEscape}
            onPress={async () => {
              if ((await save()) && finishClose()) {
                onChooseIcon();
              }
            }}
          >
            {icon}
          </Button>
          <TextField className="flex-1 min-w-0">
            <TextFieldInput
              label={t('pages.title')}
              placeholder={t('pages.untitled')}
              value={draft}
              autoFocus
              selectTextOnFocus
              editable={!saving}
              onChangeText={(next) => {
                draftRef.current = next;
                setDraft(next);
                setFailed(false);
              }}
              onSubmitEditing={() => void close()}
              onKeyPress={handleEscape}
            />
          </TextField>
        </View>
        {failed ? (
          <Text accessibilityRole="alert" className="text-sm text-destructive">
            {t('pages.header.renameFailed')}
          </Text>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
