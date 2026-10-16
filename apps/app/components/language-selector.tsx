import { useTranslation } from '@/hooks/useTranslation';
import { RiEarthLine } from '@oxy.so/bloom/icons/RiEarthLine';
import { useOxy } from '@oxy.so/services';
import { getNativeLanguageName } from '@oxy.so/core';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { useColorScheme } from '@/lib/useColorScheme';

/**
 * The app's UI language is an Oxy-account concern, not Nilo's: Oxy already
 * resolves it (account locales when signed in, a device/guest locale
 * otherwise) and ships the picker that reads and writes it
 * (`LanguageSelectorScreen`, opened here the same way every other Oxy-owned
 * surface is — `showBottomSheet('LanguageSelector')`, exactly like
 * `ManageAccount` elsewhere in Settings).
 */
export function LanguageSelector() {
  const { t } = useTranslation();
  const { colors } = useColorScheme();
  const { showBottomSheet, currentLanguage, currentLanguages } = useOxy();

  // Account locales when there are any (signed in, or a guest override was
  // set), else the single resolved device/fallback locale — the same
  // fallback `LanguageSelectorScreen` itself uses.
  const selectedLanguages = currentLanguages.length > 0 ? currentLanguages : [currentLanguage];
  const languageDescription = selectedLanguages
    .map((code) => getNativeLanguageName(code))
    .join(', ');

  return (
    <SettingsListGroup
      title={t('settings.appLanguage.title')}
      footer={t('settings.appLanguage.description')}
    >
      <SettingsListItem
        icon={<RiEarthLine size="md" fill={colors.primary} />}
        title={languageDescription}
        onPress={() => showBottomSheet?.('LanguageSelector')}
      />
    </SettingsListGroup>
  );
}
