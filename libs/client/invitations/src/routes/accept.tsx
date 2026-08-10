import {defineRoute} from '@shipfox/client-shell/runtime';
import {InvitationAcceptPage} from '#pages/invitation-accept-page.js';
import {validateInvitationAcceptSearch} from './inputs.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: validateInvitationAcceptSearch,
  component: InvitationAcceptPage,
});
