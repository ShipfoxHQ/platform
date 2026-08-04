import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Tabs, TabsContent, TabsContents, TabsList, TabsTrigger} from './tabs.js';

describe('Tabs', () => {
  test('connects the active tab to its tabpanel', async () => {
    const user = userEvent.setup();

    render(
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContents>
          <TabsContent value="summary">Summary content</TabsContent>
          <TabsContent value="jobs">Jobs content</TabsContent>
        </TabsContents>
      </Tabs>,
    );

    const summaryTab = screen.getByRole('tab', {name: 'Summary'});
    expect(summaryTab.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id);
    expect(screen.getByText('Summary content')).toBeDefined();

    await user.click(screen.getByRole('tab', {name: 'Jobs'}));

    expect(screen.getByRole('tab', {name: 'Jobs'}).getAttribute('aria-controls')).toBe(
      screen.getByRole('tabpanel').id,
    );
    expect(screen.getByText('Jobs content')).toBeDefined();
    expect(screen.queryByText('Summary content')).toBeNull();
  });

  test('scopes tab and panel ids to each Tabs instance', () => {
    render(
      <>
        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">First summary</TabsTrigger>
          </TabsList>
          <TabsContents>
            <TabsContent value="summary">First content</TabsContent>
          </TabsContents>
        </Tabs>
        <Tabs defaultValue="summary">
          <TabsList>
            <TabsTrigger value="summary">Second summary</TabsTrigger>
          </TabsList>
          <TabsContents>
            <TabsContent value="summary">Second content</TabsContent>
          </TabsContents>
        </Tabs>
      </>,
    );

    const tabs = screen.getAllByRole('tab');
    const panels = screen.getAllByRole('tabpanel');

    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panels[0]?.id);
    expect(tabs[1]?.getAttribute('aria-controls')).toBe(panels[1]?.id);
    expect(panels[0]?.id).not.toBe(panels[1]?.id);
  });

  test('keeps an opted-in tab panel mounted while inactive', async () => {
    const user = userEvent.setup();

    render(
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
        </TabsList>
        <TabsContents>
          <TabsContent value="summary">Summary content</TabsContent>
          <TabsContent value="source" keepMounted className="flex">
            Source content
          </TabsContent>
        </TabsContents>
      </Tabs>,
    );

    const sourcePanel = screen.getByText('Source content').closest('[role="tabpanel"]');
    if (!(sourcePanel instanceof HTMLElement)) throw new Error('Source panel did not render.');
    expect(sourcePanel.style.display).toBe('none');

    await user.click(screen.getByRole('tab', {name: 'Source'}));

    expect(sourcePanel.style.display).toBe('');
  });
});
