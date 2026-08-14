import {render, screen} from '@testing-library/react';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelCell,
  PanelCellAction,
  PanelEmpty,
  PanelGrid,
  PanelHeader,
  PanelRow,
  PanelTitle,
} from './panel.js';

describe('Panel', () => {
  test('renders the bordered panel shell and composes its regions', () => {
    const {container} = render(
      <Panel data-testid="panel">
        <PanelHeader>
          <PanelTitle>Runs</PanelTitle>
          <PanelActions>New run</PanelActions>
        </PanelHeader>
        <PanelBody>
          <PanelRow>Run one</PanelRow>
          <PanelRow>Run two</PanelRow>
        </PanelBody>
      </Panel>,
    );

    const panel = container.querySelector('[data-slot="panel"]');
    const header = container.querySelector('[data-slot="panel-header"]');
    const rows = container.querySelectorAll('[data-slot="panel-row"]');

    expect(panel?.classList.contains('rounded-8')).toBe(true);
    expect(panel?.classList.contains('border-border-neutral-base')).toBe(true);
    expect(header?.getAttribute('data-variant')).toBe('strip');
    expect(header?.classList.contains('bg-background-neutral-base')).toBe(true);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classList.contains('hover:bg-background-neutral-hover')).toBe(true);
  });

  test('uses a plain header without the strip divider', () => {
    const {container} = render(
      <Panel>
        <PanelHeader variant="plain">Configuration</PanelHeader>
      </Panel>,
    );

    const header = container.querySelector('[data-slot="panel-header"]');

    expect(header?.getAttribute('data-variant')).toBe('plain');
    expect(header?.classList.contains('bg-background-neutral-base')).toBe(true);
    expect(header?.classList.contains('border-b')).toBe(false);
  });

  test('removes the divider from the final row and supports compact empty content', () => {
    const {container} = render(
      <>
        <Panel>
          <PanelBody>
            <PanelRow>Only row</PanelRow>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelBody>
            <PanelEmpty compact>No runs</PanelEmpty>
          </PanelBody>
        </Panel>
      </>,
    );

    const row = container.querySelector('[data-slot="panel-row"]');
    const empty = container.querySelector('[data-slot="panel-empty"]');

    expect(row?.classList.contains('last:border-b-0')).toBe(true);
    expect(empty?.classList.contains('p-panel-compact')).toBe(true);
  });
});

/** A cell must not carry its own divider: the grid owns every hairline. */
const CELL_BORDER_PATTERN = /\bborder-[tl]\b/;

describe('PanelGrid', () => {
  test('draws its dividers from the cell position, so no caller counts indexes', () => {
    const {container} = render(
      <Panel>
        <PanelBody>
          <PanelGrid aria-label="Projects">
            <PanelCell>One</PanelCell>
            <PanelCell>Two</PanelCell>
            <PanelCell>Three</PanelCell>
          </PanelGrid>
        </PanelBody>
      </Panel>,
    );

    const grid = container.querySelector('[data-slot="panel-grid"]');
    const cells = container.querySelectorAll('[data-slot="panel-cell"]');

    expect(cells).toHaveLength(3);
    for (const cell of cells) {
      expect(cell.className).not.toMatch(CELL_BORDER_PATTERN);
    }
    // The wide and collapsed rules must share the 760px boundary, or that exact
    // viewport matches neither and the cells lose their dividers.
    expect(grid?.classList.contains('min-[760px]:[&>*:nth-child(n+3)]:border-t')).toBe(true);
    expect(grid?.classList.contains('min-[760px]:[&>*:nth-child(even)]:border-l')).toBe(true);
    expect(grid?.classList.contains('max-[760px]:[&>*:nth-child(n+2)]:border-t')).toBe(true);
    expect(grid?.classList.contains('[&>*]:border-border-neutral-base')).toBe(true);
  });
});

describe('PanelCellAction', () => {
  test('defaults to a non-submitting button with an inset focus ring', () => {
    render(<PanelCellAction>Open</PanelCellAction>);

    const action = screen.getByRole('button', {name: 'Open'});

    expect(action.getAttribute('type')).toBe('button');
    expect(action.classList.contains('focus-visible:shadow-focus-inset')).toBe(true);
    expect(action.classList.contains('hover:bg-background-neutral-hover')).toBe(true);
  });

  test('renders as its child so a link can fill the cell', () => {
    render(
      <PanelCellAction asChild>
        <a href="/projects/one">Project one</a>
      </PanelCellAction>,
    );

    const link = screen.getByRole('link', {name: 'Project one'});

    expect(link.getAttribute('type')).toBeNull();
    expect(link.classList.contains('focus-visible:shadow-focus-inset')).toBe(true);
  });

  test('owns the trailing verb and chevron that mark a cell as navigation', () => {
    const {container} = render(<PanelCellAction action="Install">GitHub</PanelCellAction>);

    const verb = container.querySelector('[data-slot="panel-cell-verb"]');

    expect(verb?.textContent).toBe('Install');
    expect(verb?.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('button').classList.contains('justify-between')).toBe(true);
  });

  test('keeps the verb inside the slotted child so a link wraps the whole cell', () => {
    render(
      <PanelCellAction asChild action="Install">
        <a href="/install/github">GitHub</a>
      </PanelCellAction>,
    );

    const link = screen.getByRole('link');

    expect(link.querySelector('[data-slot="panel-cell-verb"]')).not.toBeNull();
  });

  test('omits the affordance when the cell is not navigation', () => {
    const {container} = render(<PanelCellAction>Plain</PanelCellAction>);

    expect(container.querySelector('[data-slot="panel-cell-verb"]')).toBeNull();
    expect(screen.getByRole('button').classList.contains('justify-between')).toBe(false);
  });
});
