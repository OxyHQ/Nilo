import { View } from 'react-native';
import { Item } from '@oxy.so/bloom/item';
import { Text } from '@oxy.so/bloom/typography';
import { useTranslation } from '@/hooks/useTranslation';
import { BUILT_IN_TEMPLATES, type BuiltInTemplate, templateLocale } from '@/lib/templates/built-in';

/**
 * Nilo's own templates, in the member's language. A database template is
 * offered only where a full-page database can go: the top of a section.
 */
export function BuiltInTemplates({
  atTop,
  pending,
  onUse,
}: {
  atTop: boolean;
  pending: boolean;
  onUse: (template: BuiltInTemplate) => void;
}) {
  const { t, locale } = useTranslation();
  const language = templateLocale(locale);
  const offered = BUILT_IN_TEMPLATES.filter((template) => atTop || template.kind === 'page');
  return (
    <View accessibilityState={{ busy: pending }} className="gap-1">
      <Text className="px-3 pt-1 text-xs text-muted-foreground">
        {t('pages.templates.builtIn')}
      </Text>
      {offered.map((template) => {
        const words = template.words[language];
        return (
          <Item
            key={template.key}
            density="compact"
            disabled={pending}
            accessibilityLabel={t('pages.templates.useNamed', { title: words.title })}
            onPress={() => onUse(template)}
            leading={<Text>{template.icon}</Text>}
            title={words.title}
            subtitle={words.description}
          />
        );
      })}
    </View>
  );
}
