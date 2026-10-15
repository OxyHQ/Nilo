import { Pressable } from 'react-native';
import { Text } from '@/components/ui/text';
import * as DropdownMenu from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';
import { PAGE_GRANT_ROLES, canAssignPageRole } from '@/lib/hooks/page-access';
import type { PageGrantRole, PageRole } from '@/lib/hooks/use-page-permissions';

export function PageRolePicker({
  role,
  callerRole,
  onChange,
  disabled,
  label,
}: {
  role: PageGrantRole;
  callerRole: PageRole;
  onChange: (role: PageGrantRole) => void;
  disabled?: boolean;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Pressable
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label}
          className="h-8 px-2 justify-center rounded-lg border border-border hover:bg-muted"
        >
          <Text className="text-xs font-medium text-foreground">{t(`sharing.roles.${role}`)}</Text>
        </Pressable>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {PAGE_GRANT_ROLES.map((option) => (
          <DropdownMenu.Item
            key={option}
            disabled={!canAssignPageRole(callerRole, option)}
            onSelect={() => onChange(option)}
          >
            <DropdownMenu.ItemTitle>{t(`sharing.roles.${option}`)}</DropdownMenu.ItemTitle>
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
