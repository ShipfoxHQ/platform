import {defineRoute} from '@shipfox/client-shell/runtime';
import {GuestGuard} from '#components/auth-guard.js';
import {PasswordResetPage} from '#pages/password-reset-page.js';
import {validatePasswordResetSearch} from './inputs.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: validatePasswordResetSearch,
  component: () => (
    <GuestGuard>
      <PasswordResetPage />
    </GuestGuard>
  ),
});
