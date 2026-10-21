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
import { toast } from '@oxy.so/bloom/toast';
import { COLOR_PRESET_REGISTRY } from '@oxy.so/bloom/theme';
import { getNativeLanguageName } from '@oxy.so/core';
import { useAccountColorSave, useOxy } from '@oxy.so/services/ui/client';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useNiloSettings } from './settings-provider';

export function GeneralSection() {
  const { mode, setColorScheme } = useColorScheme();
  const { colors: allowedColors, value: colorValue, saveColor } = useAccountColorSave();
  const { t } = useTranslation();
  const { currentLanguage, currentLanguages, showBottomSheet } = useOxy();
  const { afterClose } = useNiloSettings();
  const modes = (['system', 'light', 'dark'] as const).map((value) => ({
    value,
    label: t(`settings.appearance.${value}`),
  }));
  const colors = COLOR_PRESET_REGISTRY.filter(({ name }) => allowedColors.includes(name)).map(
    ({ name, displayName }) => ({ value: name, label: displayName }),
  );
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
            value={colorValue}
            onValueChange={(value) => {
              const next = colors.find((option) => option.value === value);
              if (next)
                saveColor(next.value).catch(() =>
                  toast.error(t('settings.accentColor.saveFailed')),
                );
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
