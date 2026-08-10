import {render} from '@testing-library/react';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelEmpty,
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
