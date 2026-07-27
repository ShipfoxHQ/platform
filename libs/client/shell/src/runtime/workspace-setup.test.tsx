// @vitest-environment jsdom
import {render, screen} from '@testing-library/react';
import {WorkspaceUnavailablePage} from './workspace-setup.js';

const WORKSPACE_UNAVAILABLE_RE = /Acme is currently unavailable/u;
const ADMINISTRATION_DETAILS_RE = /reason|administrator|event/iu;

describe('WorkspaceUnavailablePage', () => {
  test('shows neutral workspace guidance without administration details', () => {
    render(<WorkspaceUnavailablePage workspaceName="Acme" />);

    expect(screen.getByRole('heading', {name: 'Workspace unavailable'})).toBeInTheDocument();
    expect(screen.getByText(WORKSPACE_UNAVAILABLE_RE)).toBeInTheDocument();
    expect(screen.queryByText(ADMINISTRATION_DETAILS_RE)).not.toBeInTheDocument();
  });
});
