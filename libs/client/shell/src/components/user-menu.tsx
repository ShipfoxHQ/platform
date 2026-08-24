import {Avatar} from '@shipfox/react-ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {useTheme} from '@shipfox/react-ui/hooks';
import type {Theme} from '@shipfox/react-ui/theme';
import {Link} from '@tanstack/react-router';
import {useAuthState} from '#runtime/auth.js';
import {useChrome} from '#runtime/chrome-context.js';
import {ReportErrorBoundary} from '#runtime/report-error-boundary.js';

const themeOptions: Array<{value: Theme; label: string}> = [
  {value: 'light', label: 'Light'},
  {value: 'dark', label: 'Dark'},
  {value: 'system', label: 'System'},
];

export function UserMenu() {
  const {user} = useAuthState();
  const {AccountMenuEntry} = useChrome();
  const {theme, setTheme} = useTheme();
  const email = user?.email ?? '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User menu"
          className="rounded-full focus-visible:outline-none focus-visible:shadow-button-neutral-focus"
        >
          <Avatar size="sm" content="letters" fallback={email} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-[220px]">
        <DropdownMenuLabel className="text-xs text-foreground-neutral-muted truncate">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-foreground-neutral-muted">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          {themeOptions.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {AccountMenuEntry ? (
          <ReportErrorBoundary label="Failed to render account menu entry.">
            <AccountMenuEntry />
          </ReportErrorBoundary>
        ) : undefined}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to={'/auth/logout' as never}>Logout</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
