import * as React from 'react';
import { RiCheckboxCircleFill } from '@oxy.so/bloom/icons/RiCheckboxCircleFill';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { Item } from '@oxy.so/bloom/item';
import { Popover, PopoverContent, PopoverTrigger } from '@oxy.so/bloom/popover';
import { toast } from '@oxy.so/bloom/toast';
import { Text } from '@oxy.so/bloom/typography';
import {
  VERIFICATION_EXPIRY_DAYS,
  type VerificationState,
  type VerificationValue,
  verificationState,
} from '@oxy.so/nilo-contracts';
import { useTranslation } from '@/hooks/useTranslation';
import { useVerifyPage } from '@/lib/hooks/use-page-verification';
import type { DatabaseProperty, PropertyValue } from '@/lib/types/databases';
import { useDatabaseCellScope } from './cell-scope';

const STATE_HUE: Record<VerificationState, 'lime' | 'orange' | 'neutral'> = {
  verified: 'lime',
  expired: 'orange',
  unverified: 'neutral',
};

/** What a stored verification value says (anything else is unverified). */
export function readVerification(value: PropertyValue): Partial<VerificationValue> {
  return value && typeof value === 'object' ? (value as Partial<VerificationValue>) : {};
}

/** The state as a chip: Verified, Expired or Unverified. */
export function VerificationChip({ value }: { value: PropertyValue }) {
  const { t } = useTranslation();
  const state = verificationState(readVerification(value));
  return (
    <Chip
      size="xs"
      hue={STATE_HUE[state]}
      leadingIcon={state === 'verified' ? RiCheckboxCircleFill : undefined}
    >
      {t(`databases.verification.states.${state}`)}
    </Chip>
  );
}

interface VerificationCellProps {
  property: DatabaseProperty;
  value: PropertyValue;
  /** The row's page: what is verified. */
  rowId?: string;
  readOnly?: boolean;
}

/**
 * A verification property's cell: its state as a chip that opens the choices:
 * verify for 7, 30 or 90 days or until removed, verify again, or remove it.
 * Writing goes through the verify route, which stamps who and when.
 */
export function VerificationCell({
  property,
  value,
  rowId,
  readOnly = false,
}: VerificationCellProps) {
  const { t, locale } = useTranslation();
  const scope = useDatabaseCellScope();
  const verify = useVerifyPage();
  const [open, setOpen] = React.useState(false);
  const stored = readVerification(value);
  const state = verificationState(stored);
  const databaseId = scope?.databaseId;

  const run = (action: 'verify' | 'unverify', expiresInDays?: number | null) => {
    if (!databaseId || !rowId) return;
    setOpen(false);
    verify.mutate(
      { databaseId, rowId, propertyId: property.id, action, expiresInDays },
      { onError: () => toast.error(t('databases.verification.failed')) },
    );
  };

  const chip = <VerificationChip value={value} />;
  if (readOnly || !databaseId || !rowId) return chip;

  const expiry =
    state === 'unverified'
      ? null
      : stored.expiresAt
        ? t('databases.verification.expires', {
            date: new Date(stored.expiresAt).toLocaleDateString(locale),
          })
        : t('databases.verification.noExpiry');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          appearance="plain"
          size="xs"
          className="self-start"
          stopPropagation
          accessibilityLabel={property.name}
        >
          {chip}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" minWidth={240} label={property.name} className="gap-1">
        {expiry ? <Text className="px-2 py-1 text-xs text-muted-foreground">{expiry}</Text> : null}
        {VERIFICATION_EXPIRY_DAYS.map((days) => (
          <Item
            key={days}
            density="compact"
            accessibilityLabel={t('databases.verification.verifyFor', { count: days })}
            title={t('databases.verification.verifyFor', { count: days })}
            onPress={() => run('verify', days)}
          />
        ))}
        <Item
          density="compact"
          accessibilityLabel={t('databases.verification.verifyForever')}
          title={t('databases.verification.verifyForever')}
          onPress={() => run('verify', null)}
        />
        {state !== 'unverified' ? (
          <Item
            density="compact"
            accessibilityLabel={t('databases.verification.remove')}
            title={t('databases.verification.remove')}
            onPress={() => run('unverify')}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
