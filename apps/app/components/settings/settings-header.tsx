import { useWindowDimensions } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';
import type { ParamListBase } from '@react-navigation/native';
import { RiMenuLine } from '@oxy.so/bloom/icons/RiMenuLine';
import { Button } from '@oxy.so/bloom/button';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { useTranslation } from '@/hooks/useTranslation';

interface SettingsHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
}

export function SettingsHeader({ title, subtitle, showBack = false, onBack }: SettingsHeaderProps) {
  const navigation = useNavigation<DrawerNavigationProp<ParamListBase>>();
  const router = useRouter();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 768;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  // A settings screen is a dense tool screen inside the drawer's content area:
  // a flat bar with its hairline, not floating islands over the content.
  return (
    <PageHeader
      presentation="bar"
      border="always"
      title={title}
      subtitle={subtitle}
      onBack={showBack ? handleBack : undefined}
      backLabel={t('common.back')}
      leading={
        isLargeScreen ? undefined : (
          <Button
            appearance="subtle"
            iconOnly
            accessibilityLabel={t('keyboardShortcuts.toggleSidebar')}
            onPress={() => navigation.toggleDrawer()}
            leadingIcon={RiMenuLine}
          />
        )
      }
    />
  );
}
