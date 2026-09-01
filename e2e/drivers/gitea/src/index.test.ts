describe('createConnectedOrg', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('links a fresh org to the workspace', async () => {
    const org = {org: 'e2e-org', teamId: 1, webhookId: 2};
    const connection = {connection_id: 'conn-1'};
    const createOrg = vi.fn().mockResolvedValue(org);
    const bestEffortDeleteOrg = vi.fn();
    const connectGiteaOrg = vi.fn().mockResolvedValue(connection);
    vi.doMock('./instance.js', () => ({
      bestEffortDeleteOrg,
      commitFiles: vi.fn(),
      createIssue: vi.fn(),
      createOrg,
      createRepo: vi.fn(),
      deleteOrg: vi.fn(),
      deleteRepo: vi.fn(),
      listIssueComments: vi.fn(),
    }));
    vi.doMock('./connect.js', () => ({connectGiteaOrg}));
    const {createConnectedOrg} = await import('./index.js');

    const result = await createConnectedOrg({
      workspaceId: 'workspace-1',
      sessionToken: 'session-token',
      name: 'e2e-org',
    });

    expect(createOrg).toHaveBeenCalledWith({name: 'e2e-org'});
    expect(connectGiteaOrg).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      sessionToken: 'session-token',
      org: 'e2e-org',
    });
    expect(bestEffortDeleteOrg).not.toHaveBeenCalled();
    expect(result).toEqual({...org, connection});
  });

  test('deletes the org when product linking fails', async () => {
    const error = new Error('link failed');
    const createOrg = vi.fn().mockResolvedValue({org: 'e2e-org', teamId: 1, webhookId: 2});
    const bestEffortDeleteOrg = vi.fn().mockResolvedValue(undefined);
    const connectGiteaOrg = vi.fn().mockRejectedValue(error);
    vi.doMock('./instance.js', () => ({
      bestEffortDeleteOrg,
      commitFiles: vi.fn(),
      createIssue: vi.fn(),
      createOrg,
      createRepo: vi.fn(),
      deleteOrg: vi.fn(),
      deleteRepo: vi.fn(),
      listIssueComments: vi.fn(),
    }));
    vi.doMock('./connect.js', () => ({connectGiteaOrg}));
    const {createConnectedOrg} = await import('./index.js');

    const result = createConnectedOrg({
      workspaceId: 'workspace-1',
      sessionToken: 'session-token',
    });

    await expect(result).rejects.toBe(error);
    expect(bestEffortDeleteOrg).toHaveBeenCalledWith('e2e-org');
  });
});
