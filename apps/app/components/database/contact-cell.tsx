import * as React from 'react';
import { Linking, Platform, Pressable, TextInput, View } from 'react-native';
import { RiPencilLine } from '@oxy.so/bloom/icons/RiPencilLine';
import { Button } from '@oxy.so/bloom/button';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { useColorScheme } from '@/lib/useColorScheme';

export type ContactKind = 'url' | 'email' | 'phone';

/**
 * Where a contact value takes the reader: a web address (`https://` when no
 * scheme was typed), a `mailto:` or a `tel:` link; null when there is nothing
 * to open.
 */
export function contactHref(kind: ContactKind, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  switch (kind) {
    case 'url':
      return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    case 'email':
      return `mailto:${trimmed}`;
    case 'phone': {
      // A dialer takes digits and a leading +; spaces, dots and dashes are for reading.
      const dialable = trimmed.replace(/[^\d+*#,;]/g, '');
      return dialable ? `tel:${dialable}` : null;
    }
  }
}

/** The keyboard and autofill a native field shows for each kind. */
const INPUT_PROPS = {
  url: {
    keyboardType: 'url',
    autoCapitalize: 'none',
    autoCorrect: false,
    textContentType: 'URL',
    inputMode: 'url',
  },
  email: {
    keyboardType: 'email-address',
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'email',
    textContentType: 'emailAddress',
    inputMode: 'email',
  },
  phone: {
    keyboardType: 'phone-pad',
    autoComplete: 'tel',
    textContentType: 'telephoneNumber',
    inputMode: 'tel',
  },
} as const;

/** Open a contact value's link. Exported for the read-only view of a value. */
export function openContact(kind: ContactKind, value: string): void {
  const href = contactHref(kind, value);
  if (!href) return;
  if (Platform.OS === 'web' && kind === 'url') {
    window.open(href, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(href).catch(() => {});
}

/** A contact value as a link that opens it. */
export function ContactLink({ kind, value }: { kind: ContactKind; value: string }) {
  if (!value) return <Text className="py-1 text-sm text-muted-foreground">—</Text>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={value}
      // The card or row around the link opens the row.
      onPress={(event) => {
        event.stopPropagation?.();
        openContact(kind, value);
      }}
    >
      <Text className="py-1 text-sm text-primary underline" numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

interface ContactCellProps {
  kind: ContactKind;
  value: string;
  label: string;
  variant: 'table' | 'panel' | 'card';
  autoFocus?: boolean;
  onChange: (next: string) => void;
}

/**
 * A URL, email or phone property: a link that opens it while it is not being
 * edited, with an edit button beside it; a field with the keyboard of its kind
 * while it is, or while it is empty.
 */
export function ContactCell({
  kind,
  value,
  label,
  variant,
  autoFocus,
  onChange,
}: ContactCellProps) {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const [editing, setEditing] = React.useState(Boolean(autoFocus));
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== value) onChange(next);
  };

  if (!editing && value) {
    return (
      <View className="flex-row items-center gap-1">
        <View className="flex-1">
          <ContactLink kind={kind} value={value} />
        </View>
        {variant !== 'card' ? (
          <Button
            iconOnly
            appearance="plain"
            size="xs"
            accessibilityLabel={t('databases.contact.edit', { property: label })}
            onPress={() => setEditing(true)}
            leadingIcon={RiPencilLine}
          />
        ) : null}
      </View>
    );
  }

  return (
    <TextInput
      {...INPUT_PROPS[kind]}
      accessibilityLabel={label}
      value={draft}
      onChangeText={setDraft}
      onBlur={commit}
      onSubmitEditing={commit}
      autoFocus={editing}
      placeholder=""
      placeholderTextColor={colors.mutedForeground}
      className={variant === 'panel' ? 'text-sm text-foreground py-1' : 'text-sm text-foreground'}
      style={
        Platform.OS === 'web'
          ? { outlineWidth: 0, borderWidth: 0, padding: 0, minWidth: 60 }
          : undefined
      }
      underlineColorAndroid="transparent"
    />
  );
}
