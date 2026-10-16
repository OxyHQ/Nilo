import { Button } from '@oxy.so/bloom/button';
import { SettingsCard, SettingsRow, SettingsSection } from '@oxy.so/bloom/settings-modal/modal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@oxy.so/bloom/select';
import { APP_COLOR_NAMES, useBloomTheme } from '@oxy.so/bloom/theme';
import { getNativeLanguageName } from '@oxy.so/core';
import { useOxy } from '@oxy.so/services';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useNiloSettings } from './settings-provider';

export function GeneralSection() {
  const { mode, setColorScheme } = useColorScheme();
  const { colorPreset, setColorPreset } = useBloomTheme();
  const { t } = useTranslation();
  const { currentLanguage, currentLanguages, showBottomSheet } = useOxy();
  const { afterClose } = useNiloSettings();
  const modes = (['system', 'light', 'dark'] as const).map((value) => ({
    value,
    label: t(`settings.appearance.${value}`),
  }));
  const colors = APP_COLOR_NAMES.map((value) => ({
    value,
    label: t(`settings.accentColor.${value}`),
  }));
  // The UI language is the Oxy account's: Oxy resolves it and owns the picker.
  const languages = currentLanguages.length ? currentLanguages : [currentLanguage];
  return (
    <SettingsSection>
      <SettingsCard>
        <SettingsRow
          label={t('settings.appLanguage.title')}
          description={t('settings.appLanguage.description')}
        >
          <Button
            appearance="outline"
            tone="neutral"
            size="sm"
            onPress={() => afterClose(() => showBottomSheet?.('LanguageSelector'))}
          >
            {languages.map(getNativeLanguageName).join(', ')}
          </Button>
        </SettingsRow>
        <SettingsRow label={t('settings.appearance.title')}>
          <Select
            value={mode}
            onValueChange={(value) => {
              const next = modes.find((option) => option.value === value);
              if (next) setColorScheme(next.value);
            }}
          >
            <SelectTrigger label={t('settings.appearance.title')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              items={modes}
              renderItem={(item) => (
                <SelectItem value={item.value} label={item.label}>
                  <SelectItemText>{item.label}</SelectItemText>
                </SelectItem>
              )}
            />
          </Select>
        </SettingsRow>
        <SettingsRow label={t('settings.accentColor.title')}>
          <Select
            value={colorPreset}
            onValueChange={(value) => {
              const next = colors.find((option) => option.value === value);
              if (next) setColorPreset(next.value);
            }}
          >
            <SelectTrigger label={t('settings.accentColor.title')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              items={colors}
              renderItem={(item) => (
                <SelectItem value={item.value} label={item.label}>
                  <SelectItemText>{item.label}</SelectItemText>
                </SelectItem>
              )}
            />
          </Select>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
