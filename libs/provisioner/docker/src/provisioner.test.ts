const mocks = vi.hoisted(() => ({
  createDockerEngine: vi.fn(() => ({})),
  createDockerLifecycle: vi.fn(),
  loadDockerTemplates: vi.fn(() => []),
  logger: {debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn()},
  startProvisioner: vi.fn(() => Promise.resolve()),
}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => mocks.logger}));
vi.mock('@shipfox/provisioner-core', () => ({startProvisioner: mocks.startProvisioner}));
vi.mock('#docker-engine.js', () => ({
  createDockerEngine: mocks.createDockerEngine,
  DockerEngineError: class extends Error {},
}));
vi.mock('#lifecycle.js', () => ({createDockerLifecycle: mocks.createDockerLifecycle}));
vi.mock('#templates.js', () => ({loadDockerTemplates: mocks.loadDockerTemplates}));

describe('Docker provisioner reservation TTL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('derives the default reservation TTL from the registration deadline', async () => {
    const {startDockerProvisioner} = await import('#provisioner.js');

    await startDockerProvisioner();

    expect(adapterOptions().reservationTtlSeconds).toBe(120);
  });

  it('derives a changed reservation TTL from the configured deadline', async () => {
    vi.stubEnv('SHIPFOX_PROVISIONER_REGISTRATION_DEADLINE_MS', '180001');
    vi.resetModules();
    const {startDockerProvisioner} = await import('#provisioner.js');

    await startDockerProvisioner();

    expect(adapterOptions().reservationTtlSeconds).toBe(181);
  });
});

function adapterOptions(): {reservationTtlSeconds: number} {
  const calls = mocks.startProvisioner.mock.calls as unknown as Array<[unknown]>;
  const options = calls.at(-1)?.[0];
  if (!options) throw new Error('Docker provisioner did not start the core provisioner.');
  return (options as {adapter: {reservationTtlSeconds: number}}).adapter;
}
