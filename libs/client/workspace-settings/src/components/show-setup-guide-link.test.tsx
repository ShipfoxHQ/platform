import {
  clearWorkspaceSetupChecklistDismissal,
  dismissWorkspaceSetupChecklist,
  isWorkspaceSetupChecklistDismissed,
} from '@shipfox/client-shell/runtime';
import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {ShowSetupGuideLink} from './show-setup-guide-link.js';

const CURRENT_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';

describe('ShowSetupGuideLink', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('is absent while the setup guide is not dismissed', () => {
    render(<ShowSetupGuideLink workspaceId={CURRENT_WORKSPACE_ID} />);

    expect(screen.queryByRole('button', {name: 'Show the setup guide'})).not.toBeInTheDocument();
  });

  test('is present while the setup guide is dismissed for the current workspace', () => {
    dismissWorkspaceSetupChecklist(CURRENT_WORKSPACE_ID);

    render(<ShowSetupGuideLink workspaceId={CURRENT_WORKSPACE_ID} />);

    expect(screen.getByRole('button', {name: 'Show the setup guide'})).toBeInTheDocument();
  });

  test('does not use another workspace dismissal flag', () => {
    dismissWorkspaceSetupChecklist(OTHER_WORKSPACE_ID);

    render(<ShowSetupGuideLink workspaceId={CURRENT_WORKSPACE_ID} />);

    expect(screen.queryByRole('button', {name: 'Show the setup guide'})).not.toBeInTheDocument();
    expect(isWorkspaceSetupChecklistDismissed(OTHER_WORKSPACE_ID)).toBe(true);
  });

  test('re-reads the dismissal flag when the window regains focus', () => {
    render(<ShowSetupGuideLink workspaceId={CURRENT_WORKSPACE_ID} />);
    dismissWorkspaceSetupChecklist(CURRENT_WORKSPACE_ID);

    fireEvent.focus(window);

    expect(screen.getByRole('button', {name: 'Show the setup guide'})).toBeInTheDocument();

    clearWorkspaceSetupChecklistDismissal(CURRENT_WORKSPACE_ID);
    fireEvent.focus(window);

    expect(screen.queryByRole('button', {name: 'Show the setup guide'})).not.toBeInTheDocument();
  });

  test('clears the dismissal flag and announces where the guide will appear', async () => {
    dismissWorkspaceSetupChecklist(CURRENT_WORKSPACE_ID);
    const user = userEvent.setup();
    render(<ShowSetupGuideLink workspaceId={CURRENT_WORKSPACE_ID} />);

    await user.click(screen.getByRole('button', {name: 'Show the setup guide'}));

    expect(isWorkspaceSetupChecklistDismissed(CURRENT_WORKSPACE_ID)).toBe(false);
    expect(screen.queryByRole('button', {name: 'Show the setup guide'})).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The setup guide will appear on the Projects page.',
    );
    expect(document.activeElement).toBe(screen.getByRole('status'));
  });
});
