import * as React from 'react';
import { View } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { Text } from '@oxy.so/bloom/typography';
import { VERIFICATION_EXPIRY_DAYS } from '@oxy.so/nilo-contracts';
import { useTranslation } from '@/hooks/useTranslation';
import { useUpdateProperty } from '@/lib/hooks/use-database-properties';
import type { DatabaseProperty } from '@/lib/types/databases';
import { SettingSelect } from './view-settings';

const FOREVER = 'forever';

/** How long a new verification lasts unless the person verifying picks another. */
export function VerificationSettings({
  databaseId,
  property,
  onDone,
}: {
  databaseId: string;
  property: DatabaseProperty;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateProperty();
  const [days, setDays] = React.useState(String(property.config?.defaultExpiryDays ?? FOREVER));
  const options = [
    ...VERIFICATION_EXPIRY_DAYS.map((d) => ({
      value: String(d),
      label: t('databases.verification.verifyFor', { count: d }),
    })),
    { value: FOREVER, label: t('databases.verification.verifyForever') },
  ];

  return (
    <View className="gap-3">
      <SettingSelect
        label={t('databases.verification.defaultExpiry')}
        value={days}
        options={options}
        onChange={setDays}
      />
      {update.isError ? (
        <Text accessibilityRole="alert" className="text-base text-destructive">
          {t('databases.formula.saveFailed')}
        </Text>
      ) : null}
      <Button
        appearance="solid"
        tone="accent"
        disabled={update.isPending}
        onPress={() => {
          const { defaultExpiryDays: _previous, ...rest } = property.config ?? {};
          update.mutate(
            {
              databaseId,
              propertyId: property.id,
              config: days === FOREVER ? rest : { ...rest, defaultExpiryDays: Number(days) },
            },
            { onSuccess: onDone },
          );
        }}
      >
        {t('common.save')}
      </Button>
    </View>
  );
}
