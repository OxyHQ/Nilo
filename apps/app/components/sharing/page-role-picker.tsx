import { Button } from '@oxy.so/bloom/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxy.so/bloom/dropdown-menu';
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button appearance="outline" size="sm" disabled={disabled} accessibilityLabel={label}>
          {t(`sharing.roles.${role}`)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {PAGE_GRANT_ROLES.map((option) => (
          <DropdownMenuItem
            key={option}
            disabled={!canAssignPageRole(callerRole, option)}
            onPress={() => onChange(option)}
          >
            {t(`sharing.roles.${option}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
