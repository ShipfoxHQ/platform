export const SIGNUP_DENIAL_MESSAGE_MAX_LENGTH = 500;
export type SignupDenialMessageFormat = 'markdown';

export interface SignupPolicy {
  isSignupAllowed(params: {
    email: string;
    emailVerified: boolean;
    source: string;
  }): Promise<
    {allowed: true} | {allowed: false; message?: string; format?: SignupDenialMessageFormat}
  >;
}
