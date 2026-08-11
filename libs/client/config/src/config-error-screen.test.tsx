import {render, screen} from '@testing-library/react';
import {ConfigErrorScreen} from './config-error-screen.js';
import type {ConfigKeyError} from './load-config.js';

const apiUrlError: ConfigKeyError = {
  key: 'apiUrl',
  envVars: ['SHIPFOX_PUBLIC_API_URL', 'VITE_API_URL'],
  description: 'Base URL of the Shipfox API.',
  message: 'Invalid URL',
};

describe('ConfigErrorScreen', () => {
  it('shows each key with its description, reason, and env var', () => {
    render(<ConfigErrorScreen errors={[apiUrlError]} />);

    expect(screen.getByText('apiUrl')).toBeInTheDocument();
    expect(screen.getByText('Base URL of the Shipfox API.')).toBeInTheDocument();
    expect(screen.getByText('Invalid URL')).toBeInTheDocument();
    expect(screen.getByText('SHIPFOX_PUBLIC_API_URL')).toBeInTheDocument();
  });

  it('renders the docs link only when a url is given', () => {
    const {container, rerender} = render(<ConfigErrorScreen errors={[apiUrlError]} />);

    expect(screen.queryByRole('link')).toBeNull();

    rerender(<ConfigErrorScreen errors={[apiUrlError]} docsUrl="https://docs.shipfox.io/config" />);

    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://docs.shipfox.io/config');
    expect(container.querySelector('[data-slot="panel"]')).toHaveClass('gap-group');
    expect(container.querySelector('[data-slot="panel-body"]')).toHaveClass('flex', 'flex-col');
    expect(container.querySelector('[data-slot="panel-body"] > div')).toHaveClass(
      'px-row',
      'py-row',
    );
  });
});
