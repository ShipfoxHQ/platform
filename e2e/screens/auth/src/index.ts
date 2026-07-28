import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;

export class LoginScreen {
  constructor(private readonly page: Page) {}

  async goto(redirect?: string): Promise<void> {
    const suffix = redirect === undefined ? '' : `?redirect=${redirect}`;
    await this.page.goto(`/auth/login${suffix}`);
  }

  async gotoRawRedirect(redirect: string): Promise<void> {
    await this.page.goto(`/auth/login?redirect=${redirect}`);
  }

  heading(): Locator {
    return this.page.getByRole('heading', {name: 'Connect to Shipfox'});
  }

  emailField(): Locator {
    return this.page.getByLabel('Email');
  }

  passwordField(): Locator {
    return this.page.getByLabel('Password');
  }

  submitButton(): Locator {
    return this.page.getByRole('button', {name: 'Log in'});
  }

  async submit(email: string, password: string): Promise<void> {
    await this.emailField().fill(email);
    await this.passwordField().fill(password);
    await this.submitButton().click();
  }
}

export class SignupScreen {
  constructor(private readonly page: Page) {}
  async goto(): Promise<void> {
    await this.page.goto('/auth/signup');
  }
  heading(): Locator {
    return this.page.getByRole('heading', {name: 'Create your Shipfox account'});
  }
  nameField(): Locator {
    return this.page.getByLabel('Name');
  }
  emailField(): Locator {
    return this.page.getByLabel('Email');
  }
  passwordField(): Locator {
    return this.page.getByLabel('Password');
  }
  submitButton(): Locator {
    return this.page.getByRole('button', {name: 'Create account'});
  }
  alert(): Locator {
    return this.page.getByRole('alert');
  }
  verificationHeading(): Locator {
    return this.page.getByRole('heading', {name: 'Check your email'});
  }
  async submit(params: {email: string; name: string; password: string}): Promise<void> {
    await this.nameField().fill(params.name);
    await this.emailField().fill(params.email);
    await this.passwordField().fill(params.password);
    await this.submitButton().click();
  }
}
export class GuestRedirectScreen {
  constructor(private readonly page: Page) {}

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  onboardingHeading(): Locator {
    return this.page.getByRole('heading', {name: 'Create your workspace'});
  }

  workspaceNameField(): Locator {
    return this.page.getByLabel('Workspace name');
  }
}

export interface AuthScreenFixtures {
  guestRedirects: GuestRedirectScreen;
  login: LoginScreen;
  signup: SignupScreen;
}

export const authScreens = {
  guestRedirects: async ({page}: {page: Page}, use: FixtureUse<GuestRedirectScreen>) => {
    await use(new GuestRedirectScreen(page));
  },
  login: async ({page}: {page: Page}, use: FixtureUse<LoginScreen>) => {
    await use(new LoginScreen(page));
  },
  signup: async ({page}: {page: Page}, use: FixtureUse<SignupScreen>) => {
    await use(new SignupScreen(page));
  },
};
