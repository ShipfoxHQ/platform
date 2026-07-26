export interface SignupPolicy {
  isSignupAllowed(params: {
    email: string;
    emailVerified: boolean;
    source: string;
  }): Promise<{allowed: true} | {allowed: false; message?: string}>;
}
