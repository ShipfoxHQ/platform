import {spawnSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {freezePlannedRunCommandAtSite} from '../plan/freeze-run-command.js';
import {planInterpolationField} from '../plan/plan-field.js';
import type {ResolvedField} from '../plan/resolved-field.js';
import {WorkflowTemplateResolutionError} from '../resolver/errors.js';
import {parseWorkflowTemplate} from '../template/parse-workflow-template.js';
import {hoistPlannedRunCommand, UnsafeRunInterpolationError} from './hoist-run-command.js';

const templateOpen = '$' + '{{';
const templateClose = '}' + '}';
const adversarialPayloadRoot = mkdtempSync(join(tmpdir(), 'shipfox-run-payloads-'));
const shellIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

afterAll(() => {
  rmSync(adversarialPayloadRoot, {force: true, recursive: true});
});

function templateExpression(source: string): string {
  return `${templateOpen}${source}${templateClose}`;
}

function shellRef(name: string): string {
  return `"\${${name}}"`;
}

function doubleQuotedShellRef(name: string): string {
  return `\${${name}}`;
}

function singleQuotedShellRef(name: string): string {
  return `'"\${${name}}"'`;
}

function plannedField(source: string): ResolvedField {
  const plan = planInterpolationField({field: 'run', segments: parseWorkflowTemplate(source)});
  if (!plan.ok) throw new Error('Invalid planned test field');
  return plan.plan.field;
}

function freezeCommand(
  source: string,
  context: Record<string, unknown>,
  failurePolicy: 'fail' | 'degrade' = 'degrade',
) {
  return freezePlannedRunCommandAtSite({
    field: plannedField(source),
    site: 'run-creation',
    context,
    failurePolicy,
  });
}

describe('hoistPlannedRunCommand', () => {
  it('returns literal-only commands unchanged', () => {
    const field = plannedField('echo deploy main');

    const result = hoistPlannedRunCommand({field});

    expect(result).toEqual({command: 'echo deploy main', bindings: []});
  });

  it.each([
    ['unquoted', `echo ${templateExpression(' run.id ')}!`, `echo ${shellRef('__sf_0')}!`],
    [
      'double',
      `echo "${templateExpression(' run.id ')}!"`,
      `echo "${doubleQuotedShellRef('__sf_0')}!"`,
    ],
    [
      'single',
      `echo '${templateExpression(' run.id ')}!'`,
      `echo '${singleQuotedShellRef('__sf_0')}!'`,
    ],
  ] as const)('hoists %s interpolation sites', (_name, source, expectedCommand) => {
    const field = plannedField(source);

    const result = hoistPlannedRunCommand({field});

    expect(result.command).toBe(expectedCommand);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]?.name).toBe('__sf_0');
    expect(result.bindings[0]?.segment.expression.source).toBe('run.id');
  });

  it('hoists multiple adjacent sites with braced references', () => {
    const field = plannedField(
      `${templateExpression(' run.id ')}${templateExpression(' job.id ')}_suffix`,
    );

    const result = hoistPlannedRunCommand({field});

    expect(result.command).toBe(`${shellRef('__sf_0')}${shellRef('__sf_1')}_suffix`);
    expect(result.bindings.map((binding) => binding.name)).toEqual(['__sf_0', '__sf_1']);
  });

  it('skips reserved names and generates shell identifiers', () => {
    const field = plannedField(
      `${templateExpression(' run.id ')} ${templateExpression(' job.id ')}`,
    );

    const result = hoistPlannedRunCommand({field, reservedNames: ['__sf_0']});

    expect(result.command).toBe(`${shellRef('__sf_1')} ${shellRef('__sf_2')}`);
    expect(result.bindings.map((binding) => binding.name)).toEqual(['__sf_1', '__sf_2']);
    for (const binding of result.bindings) {
      expect(binding.name).toMatch(shellIdentifierPattern);
    }
  });

  it.each([
    [`echo $((1 + ${templateExpression(' run.id ')}))`, 'arith'],
    [`echo $[1 + ${templateExpression(' run.id ')}]`, 'arith'],
    [`echo $[a[0] + ${templateExpression(' run.id ')}]`, 'arith'],
    [`echo $\\\n(date ${templateExpression(' run.id ')})`, 'paren-sub'],
    [`echo $\\\n[1 + ${templateExpression(' run.id ')}]`, 'arith'],
    [`echo $\\\n(\\\n(1 + ${templateExpression(' run.id ')}))`, 'arith'],
    [`echo $(date ${templateExpression(' run.id ')})`, 'paren-sub'],
    [`echo \`date ${templateExpression(' run.id ')}\``, 'backtick'],
    [`echo ${'${value:-'}${templateExpression(' run.id ')}}`, 'param-brace'],
    [`echo $'${templateExpression(' run.id ')}'`, 'dollar-single'],
    [`echo $"${templateExpression(' run.id ')}"`, 'dollar-double'],
    [`cat <<EOF\n${templateExpression(' run.id ')}\nEOF`, 'heredoc'],
    [`cat <<${templateExpression(' run.id ')}\nbody\n`, 'heredoc'],
    [`echo \\${templateExpression(' run.id ')}`, 'escape'],
    [`echo "prefix\\${templateExpression(' run.id ')}"`, 'escape'],
  ] as const)('rejects interpolation inside %s', (source, region) => {
    const field = plannedField(source);

    let error: unknown;
    try {
      hoistPlannedRunCommand({field});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(UnsafeRunInterpolationError);
    expect(error).toMatchObject({
      code: 'unsafe-run-interpolation',
      name: 'UnsafeRunInterpolationError',
      region,
      source: 'run.id',
    });
    expect((error as Error).message).toContain('Bind the value to env and reference $VAR');
  });

  it('retains every unsafe interpolation and safe binding in the error analysis', () => {
    const field = plannedField(
      `echo $(${templateExpression(' run.first ')}) ; eval "${templateExpression(' run.second ')}"; echo $((1 + ${templateExpression(' run.third ')}))`,
    );

    let error: unknown;
    try {
      hoistPlannedRunCommand({field});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(UnsafeRunInterpolationError);
    expect(error).toMatchObject({
      occurrences: [
        {region: 'paren-sub', source: 'run.first'},
        {region: 'arith', source: 'run.third'},
      ],
      partial: {
        bindings: [{name: '__sf_0'}],
      },
    });
  });

  it('does not let quotes inside comments affect later interpolation sites', () => {
    const field = plannedField(
      `# "comment only"\nprintf '%s\\n' ${templateExpression(' run.id ')}`,
    );

    const result = hoistPlannedRunCommand({field});

    expect(result.command).toBe(`# "comment only"\nprintf '%s\\n' ${shellRef('__sf_0')}`);
  });

  it('does not treat a hash after escaped whitespace as a comment', () => {
    const field = plannedField(`printf %s foo\\ #${templateExpression(' run.id ')}`);

    const result = hoistPlannedRunCommand({field});

    expect(result.command).toBe(`printf %s foo\\ #${shellRef('__sf_0')}`);
  });
});

describe('freezePlannedRunCommandAtSite', () => {
  it('freezes hoisted values into env bindings', () => {
    const result = freezeCommand(
      `echo ${templateExpression(' run.id ')} ${templateExpression(' job.metadata ')}`,
      {
        run: {id: 42},
        job: {metadata: {runner: 'macos'}},
      },
    );

    expect(result).toEqual({
      command: `echo ${shellRef('__sf_0')} ${shellRef('__sf_1')}`,
      env: {
        __sf_0: '42',
        __sf_1: '{"runner":"macos"}',
      },
      diagnostics: [],
    });
  });

  it('keeps resolved raw values out of the effective command', () => {
    const result = freezeCommand(`echo ${templateExpression(' run.value ')}`, {
      run: {value: 'raw-value-that-must-not-appear'},
    });

    expect(result.command).toBe(`echo ${shellRef('__sf_0')}`);
    expect(result.command).not.toContain('raw-value-that-must-not-appear');
    expect(result.env).toEqual({__sf_0: 'raw-value-that-must-not-appear'});
  });

  it('uses missing-path diagnostics by default', () => {
    const result = freezeCommand(`echo ${templateExpression(' run.missing ')}`, {run: {}});

    expect(result).toEqual({
      command: `echo ${shellRef('__sf_0')}`,
      env: {__sf_0: ''},
      diagnostics: [
        {
          reason: 'missing-path',
          expression: 'run.missing',
          contextRoots: ['run'],
        },
      ],
    });
  });

  it('throws when fail-policy bindings are missing at the freeze site', () => {
    const act = () =>
      freezeCommand(`echo ${templateExpression(' run.missing ')}`, {run: {}}, 'fail');

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });
});

describe('resolved run command execution', () => {
  it.each(
    adversarialCases(),
  )('keeps %s inert in %s with %s', (_payloadName, _contextName, shell, source, value, markerPath) => {
    const result = freezeCommand(source, {run: {value}});
    const scriptDir = mkdtempSync(join(tmpdir(), 'shipfox-run-hoist-'));
    const scriptPath = join(scriptDir, 'script.sh');

    try {
      writeFileSync(scriptPath, result.command, {mode: 0o700});

      const shellResult = spawnSync(shell.executable, [...shell.args, scriptPath], {
        env: {...process.env, ...result.env},
      });

      expect(shellResult.status).toBe(0);
      expect(shellResult.stderr.toString()).toBe('');
      expect(shellResult.stdout).toEqual(Buffer.from(`${value}\n`));
      expect(result.command).not.toContain(value);
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      rmSync(scriptDir, {force: true, recursive: true});
    }
  });
});

interface TestShell {
  readonly executable: string;
  readonly args: readonly string[];
}

function adversarialCases(): [string, string, TestShell, string, string, string][] {
  const cases: [string, string, TestShell, string, string, string][] = [];

  for (const shell of availableShells()) {
    for (const payload of payloads()) {
      for (const context of commandContexts()) {
        cases.push([
          payload.name,
          context.name,
          shell,
          context.source,
          payload.value,
          payload.markerPath,
        ]);
      }
    }
  }

  return cases;
}

function availableShells(): TestShell[] {
  const shells: TestShell[] = [];

  if (spawnSync('bash', ['--version']).status === 0) {
    shells.push({executable: 'bash', args: ['--noprofile', '--norc', '-eo', 'pipefail']});
  }

  if (spawnSync('sh', ['-c', 'exit 0']).status === 0) {
    shells.push({executable: 'sh', args: ['-e']});
  }

  return shells;
}

function commandContexts() {
  const expression = templateExpression(' run.value ');
  return [
    {name: 'unquoted argument', source: `printf '%s\\n' ${expression}`},
    {name: 'double-quoted argument', source: `printf '%s\\n' "${expression}"`},
    {name: 'single-quoted argument', source: `printf '%s\\n' '${expression}'`},
  ];
}

function payloads() {
  const marker = (name: string) => join(adversarialPayloadRoot, `${name}.marker`);

  return [
    {name: 'semicolon', value: `; touch ${marker('semicolon')}`, markerPath: marker('semicolon')},
    {
      name: 'command-substitution',
      value: `$(touch ${marker('command-substitution')})`,
      markerPath: marker('command-substitution'),
    },
    {
      name: 'backtick',
      value: `\`touch ${marker('backtick')}\``,
      markerPath: marker('backtick'),
    },
    {name: 'pipe', value: `| tee ${marker('pipe')}`, markerPath: marker('pipe')},
    {
      name: 'newline',
      value: `\ntouch ${marker('newline')}`,
      markerPath: marker('newline'),
    },
    {name: 'glob', value: '*?[', markerPath: marker('glob')},
    {name: 'ifs', value: '$' + '{IFS}', markerPath: marker('ifs')},
    {name: 'leading-option-n', value: '-n', markerPath: marker('leading-option-n')},
    {name: 'leading-option-e', value: '-e', markerPath: marker('leading-option-e')},
    {
      name: 'comment',
      value: `# comment\ntouch ${marker('comment')}`,
      markerPath: marker('comment'),
    },
    {
      name: 'trailing-backslash',
      value: `\\\ntouch ${marker('trailing-backslash')}`,
      markerPath: marker('trailing-backslash'),
    },
  ];
}
