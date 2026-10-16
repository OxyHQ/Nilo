import * as React from 'react';
import { View, Pressable } from 'react-native';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react-native';
import { Button } from '@oxy.so/bloom/button';
import { Collapsible } from '@oxy.so/bloom/collapsible';
import { Text } from '@oxy.so/bloom/typography';
import { useColorScheme } from '@/lib/useColorScheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useUIStore, type SidebarSectionKey } from '@/lib/stores/ui-store';

interface SidebarSectionProps {
  /** Persist key — controls collapsed state in the UI store. */
  sectionKey?: SidebarSectionKey;
  /** Section title (rendered as small uppercase text). */
  title: string;
  /** Inline action shown on hover (web) or always (native). */
  onAdd?: () => void;
  adding?: boolean;
  /** Whether to render the chevron toggle. Defaults to true. */
  collapsible?: boolean;
  /** Children rendered when expanded. */
  children: React.ReactNode;
  /** Optional indicator (e.g., unread count badge) rendered before the chevron. */
  trailing?: React.ReactNode;
}

/**
 * Reusable Notion-style sidebar section: small uppercase heading + collapsible
 * body. Collapsed state persists per-section in the UI store.
 *
 * When `sectionKey` is omitted, the section is always expanded (used for
 * sections that don't need persistence like "Recents").
 */
export function SidebarSection({
  sectionKey,
  title,
  onAdd,
  adding,
  collapsible = true,
  children,
  trailing,
}: SidebarSectionProps) {
  const { colors } = useColorScheme();
  const { t } = useTranslation();
  const collapsed = useUIStore((s) => (sectionKey ? s.sectionCollapsed[sectionKey] : false));
  const toggle = useUIStore((s) => s.toggleSection);

  const isOpen = !collapsed;

  const handleToggle = React.useCallback(() => {
    if (!collapsible || !sectionKey) return;
    toggle(sectionKey);
  }, [collapsible, sectionKey, toggle]);

  return (
    <View className="py-1">
      <View className="group/section flex-row items-center px-2">
        <Pressable
          onPress={handleToggle}
          accessibilityLabel={
            isOpen ? t('sidebar.collapseSection', { title }) : t('sidebar.expandSection', { title })
          }
          accessibilityRole="button"
          aria-expanded={collapsible && sectionKey ? isOpen : undefined}
          disabled={!collapsible || !sectionKey}
          className="flex-1 flex-row items-center gap-1 rounded-md px-1 py-1 hover:bg-muted/50"
        >
          {collapsible && sectionKey ? (
            isOpen ? (
              <ChevronDown size={10} color={colors.mutedForeground} />
            ) : (
              <ChevronRight size={10} color={colors.mutedForeground} />
            )
          ) : (
            <View style={{ width: 10, height: 10 }} />
          )}
          <Text className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </Text>
        </Pressable>
        {trailing ? <View className="mr-1">{trailing}</View> : null}
        {onAdd ? (
          <Button
            appearance="plain"
            size="xs"
            iconOnly
            onPress={onAdd}
            accessibilityLabel={t('sidebar.addToSection', { title })}
            disabled={adding}
            loading={adding}
            renderLeadingIcon={({ size, color }) => <Plus size={size} color={color} />}
          />
        ) : null}
      </View>
      <Collapsible open={isOpen} contentClassName="mt-0.5">
        {children}
      </Collapsible>
    </View>
  );
}
