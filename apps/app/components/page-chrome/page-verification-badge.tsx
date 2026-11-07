import { View } from 'react-native';
import { verificationState } from '@oxy.so/nilo-contracts';
import { VerificationChip, readVerification } from '@/components/database/verification-cell';
import { useDatabase } from '@/lib/hooks/use-databases';
import type { PropertyValue } from '@/lib/types/databases';
import type { Page } from '@/lib/types/pages';

/**
 * The row's verification beside its title: Verified, or Expired when it ran
 * out, so a reader knows whether to trust the page. A page that was never
 * verified shows nothing; the property in its panel verifies it.
 */
export function PageVerificationBadge({ page }: { page: Page }) {
  const { data } = useDatabase(page.databaseId ?? undefined);
  const property = data?.database.schema.properties.find((p) => p.type === 'verification');
  if (!property) return null;
  const value = (page.properties?.[property.id] ?? null) as PropertyValue;
  if (verificationState(readVerification(value)) === 'unverified') return null;
  return (
    <View className="mb-2 self-start">
      <VerificationChip value={value} />
    </View>
  );
}
