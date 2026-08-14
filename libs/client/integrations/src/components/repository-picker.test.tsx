import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {Repository} from '#core/models.js';
import {RepositoryPicker} from './repository-picker.js';

const originalScrollWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'scrollWidth',
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'clientWidth',
);

afterEach(() => {
  restoreElementWidthDescriptors();
});

describe('RepositoryPicker', () => {
  test('renders the default empty message without an internal search control', () => {
    renderPicker();

    expect(screen.getByText('No repositories found.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  test('renders a custom empty message', () => {
    renderPicker({emptyMessage: 'No repositories visible to this connection.'});

    expect(screen.getByText('No repositories visible to this connection.')).toBeInTheDocument();
  });

  test('renders repository names without owner or default branch metadata', () => {
    renderPicker({
      repositories: [
        repository({name: 'platform', fullName: 'acme/platform', defaultBranch: 'main'}),
      ],
    });

    expect(screen.getByRole('radio', {name: 'platform'})).toBeInTheDocument();
    expect(screen.queryByText('acme/platform')).not.toBeInTheDocument();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
  });

  test('shows the name-only tooltip when a repository name is truncated on hover', async () => {
    setElementWidths({scrollWidth: 220, clientWidth: 100});
    const user = userEvent.setup();
    const repositoryName = 'acme-platform-infrastructure-control-plane';

    renderPicker({repositories: [repository({name: repositoryName})]});
    const radio = screen.getByRole('radio', {name: repositoryName});

    await user.hover(radio);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(repositoryName);
  });

  test('shows the name-only tooltip when a truncated repository name receives keyboard focus', async () => {
    setElementWidths({scrollWidth: 220, clientWidth: 100});
    const repositoryName = 'acme-platform-infrastructure-control-plane';

    renderPicker({repositories: [repository({name: repositoryName})]});
    const radio = screen.getByRole('radio', {name: repositoryName});

    fireEvent.focus(radio);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(repositoryName);
  });

  test('does not render tooltip content when a repository name is not truncated', () => {
    setElementWidths({scrollWidth: 80, clientWidth: 100});

    renderPicker({repositories: [repository({name: 'platform'})]});
    fireEvent.focus(screen.getByRole('radio', {name: 'platform'}));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('renders four accessible loading placeholders in the repository grid', () => {
    const {container} = renderPicker({
      repositories: [],
      isLoading: true,
    });

    expect(screen.getByRole('status')).toHaveTextContent('Loading repositories.');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();

    const loadingGrid = container.querySelector('[aria-hidden="true"]');
    if (!loadingGrid) throw new Error('Repository loading grid was not rendered');

    expect(loadingGrid).toHaveClass(
      'grid',
      'grid-cols-2',
      'gap-px',
      'bg-border-neutral-base',
      'max-[760px]:grid-cols-1',
    );
    expect(loadingGrid.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
    for (const placeholder of loadingGrid.querySelectorAll(':scope > div')) {
      expect(placeholder).toHaveClass('h-50', 'bg-background-neutral-base', 'p-[14px]');
      expect(placeholder).not.toHaveClass('rounded-8', 'border');
    }
  });
});

function renderPicker(
  props: Partial<Parameters<typeof RepositoryPicker>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <RepositoryPicker
      repositories={[]}
      selectedRepositoryId={undefined}
      onSelect={() => undefined}
      isLoading={false}
      {...props}
    />,
  );
}

function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    connectionId: 'connection-1',
    externalRepositoryId: 'repository-1',
    owner: 'acme',
    name: 'platform',
    fullName: 'acme/platform',
    defaultBranch: 'main',
    visibility: 'private',
    cloneUrl: 'https://github.example.test/acme/platform.git',
    htmlUrl: 'https://github.example.test/acme/platform',
    ...overrides,
  };
}

function setElementWidths(widths: {scrollWidth: number; clientWidth: number}) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => widths.scrollWidth,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => widths.clientWidth,
  });
}

function restoreElementWidthDescriptors() {
  if (originalScrollWidth) {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', originalScrollWidth);
  } else {
    delete (window.HTMLElement.prototype as {scrollWidth?: number}).scrollWidth;
  }

  if (originalClientWidth) {
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', originalClientWidth);
  } else {
    delete (window.HTMLElement.prototype as {clientWidth?: number}).clientWidth;
  }
}
