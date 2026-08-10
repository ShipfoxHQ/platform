import {defineRoute} from '@shipfox/client-shell/runtime';
import {GuestGuard} from '#components/auth-guard.js';
import {LoginPage} from '#pages/login-page.js';
import {validateRedirectSearch} from './inputs.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: validateRedirectSearch,
  component: () => (
    <GuestGuard>
      <LoginPage />
    </GuestGuard>
  ),
});
