import {parseRunnerIdentity} from './runner-identity.js';

describe('parseRunnerIdentity', () => {
  it('preserves canonical labels and extracts grouping values', () => {
    expect(
      parseRunnerIdentity(
        ['CPU.4', 'class.large', 'arch.Arm64', 'shipfox-managed', 'cpu.4'],
        'installation',
      ),
    ).toEqual({
      runnerLabels: ['arch.arm64', 'class.large', 'cpu.4', 'shipfox-managed'],
      runnerClass: 'large',
      runnerArch: 'arm64',
      runnerCpu: '4',
      managed: true,
    });
  });

  it('does not infer a managed runner from a workspace-scoped provisioner', () => {
    expect(parseRunnerIdentity(['shipfox-managed'], 'workspace').managed).toBe(false);
    expect(parseRunnerIdentity(['shipfox-managed'], null).managed).toBe(false);
  });

  it('keeps missing labels distinguishable from an empty derived identity', () => {
    expect(parseRunnerIdentity(null, 'installation')).toEqual({
      runnerLabels: null,
      runnerClass: null,
      runnerArch: null,
      runnerCpu: null,
      managed: null,
    });
  });
});
