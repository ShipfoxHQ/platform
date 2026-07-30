import {classifyShellCodePosition} from './shell-code-position.js';

const workflowDataNames = ['MSG', '__sf_0'];

describe('classifyShellCodePosition', () => {
  it.each([
    ['eval "$MSG"', 'eval'],
    ['sh -c "$MSG"', 'sh-c'],
    ['bash -c "$MSG"', 'bash-c'],
    ['source "$MSG"', 'source'],
    ['. "$MSG"', 'source'],
    ['let "$MSG"', 'let'],
    ['declare -i "$MSG"', 'declare-i'],
    ['$(( MSG + 1 ))', 'arithmetic'],
    ['(( MSG + 1 ))', 'arithmetic'],
    ['awk "$MSG"', 'awk'],
    ['jq "$MSG"', 'jq'],
    ['sed "$MSG"', 'sed'],
    ['awk -e "$MSG"', 'awk'],
    ['sed -e "$MSG"', 'sed'],
    ['sed -ne "$MSG"', 'sed'],
    ['jq -s "$MSG"', 'jq'],
    ['sh -lc "$MSG"', 'sh-c'],
    ['bash --command "$MSG"', 'bash-c'],
    ['xargs sh -c "$MSG"', 'xargs-sh-c'],
  ] as const)('reports workflow data in the %s code position', (command, construct) => {
    const result = classifyShellCodePosition({command, workflowDataNames});

    expect(result.matches).toContainEqual({name: 'MSG', construct});
  });

  it.each([
    'sh -c \'echo "$1"\' _ "$MSG"',
    'bash -c \'echo "$1"\' _ "$MSG"',
    'source ./scripts/setup.sh',
    'eval "$(cat script.sh)"',
    'xargs cmd "$MSG"',
    'xargs sh -c \'echo "$1"\' _ "$MSG"',
    'jq --arg v "$MSG" \'$v\'',
    'awk -f "$MSG" \'{print}\'',
    'sed -f "$MSG" \'s/a/b/\'',
    'sed -i \'s/a/b/\' "$MSG"',
    'declare -i MSG',
    'let MSG=1',
    '(( MSG = 1 ))',
    '((MSG=1))',
  ] as const)('does not report workflow data in the %s data position', (command) => {
    const result = classifyShellCodePosition({command, workflowDataNames});

    expect(result.matches).toEqual([]);
  });

  it.each([
    ['eval "$(cat script.sh)"; eval "$__sf_0"', {name: '__sf_0', construct: 'eval'}, undefined],
    [
      'sh -c \'echo "$1"\' _ "$MSG"; sh -c "$__sf_0"',
      {name: '__sf_0', construct: 'sh-c'},
      {name: 'MSG', construct: 'sh-c'},
    ],
    [
      'source ./scripts/setup.sh "$MSG"; source "$__sf_0"',
      {name: '__sf_0', construct: 'source'},
      {name: 'MSG', construct: 'source'},
    ],
    [
      'jq --arg v "$MSG" "$__sf_0"',
      {name: '__sf_0', construct: 'jq'},
      {name: 'MSG', construct: 'jq'},
    ],
    [
      'jq --argfile file "$MSG" "$__sf_0"',
      {name: '__sf_0', construct: 'jq'},
      {name: 'MSG', construct: 'jq'},
    ],
    [
      'awk -f "$MSG" \'{print}\'; awk "$__sf_0"',
      {name: '__sf_0', construct: 'awk'},
      {name: 'MSG', construct: 'awk'},
    ],
    [
      'sed -f "$MSG" \'s/a/b/\'; sed "$__sf_0"',
      {name: '__sf_0', construct: 'sed'},
      {name: 'MSG', construct: 'sed'},
    ],
    [
      'sed -i \'s/a/b/\' "$MSG"; sed "$__sf_0"',
      {name: '__sf_0', construct: 'sed'},
      {name: 'MSG', construct: 'sed'},
    ],
    [
      'xargs cmd "$MSG"; xargs sh -c "$__sf_0"',
      {name: '__sf_0', construct: 'xargs-sh-c'},
      {name: 'MSG', construct: 'xargs-sh-c'},
    ],
  ] as const)('distinguishes the data argument from the code argument in %s', (command, allowed, forbidden) => {
    const result = classifyShellCodePosition({command, workflowDataNames});

    expect(result.matches).toContainEqual(allowed);
    if (forbidden !== undefined) expect(result.matches).not.toContainEqual(forbidden);
  });

  it('recognizes generated bindings and direct references in the same command word', () => {
    const result = classifyShellCodePosition({
      command: `eval "prefix-\${__sf_0}-suffix"`,
      workflowDataNames,
    });

    expect(result.matches).toEqual([{name: '__sf_0', construct: 'eval'}]);
  });

  it('reports arithmetic references without following command substitutions', () => {
    const result = classifyShellCodePosition({
      command: 'echo $(( MSG + $(cat script.sh) ))',
      workflowDataNames,
    });

    expect(result.matches).toEqual([{name: 'MSG', construct: 'arithmetic'}]);
  });

  it.each([
    ['sudo eval "$MSG"', {name: 'MSG', construct: 'eval'}],
    ['env eval "$MSG"', {name: 'MSG', construct: 'eval'}],
    ['command eval "$MSG"', {name: 'MSG', construct: 'eval'}],
    ['nohup eval "$MSG"', {name: 'MSG', construct: 'eval'}],
  ] as const)('follows the %s command wrapper', (command, expected) => {
    const result = classifyShellCodePosition({command, workflowDataNames});

    expect(result.matches).toContainEqual(expected);
  });

  it.each([
    ['let "y = MSG == 2"', [{name: 'MSG', construct: 'let'}]],
    ['let "y = MSG >= 2"', [{name: 'MSG', construct: 'let'}]],
    ['(( MSG = 1 ))', []],
    ['((MSG=1))', []],
    ['(( MSG += 1 ))', [{name: 'MSG', construct: 'arithmetic'}]],
    ['(( MSG -= 1 ))', [{name: 'MSG', construct: 'arithmetic'}]],
    ['(( MSG *= 1 ))', [{name: 'MSG', construct: 'arithmetic'}]],
    ['(( MSG <<= 1 ))', [{name: 'MSG', construct: 'arithmetic'}]],
    ['(( MSG >>= 1 ))', [{name: 'MSG', construct: 'arithmetic'}]],
    ['let "MSG += 1"', [{name: 'MSG', construct: 'let'}]],
    ['declare -i MSG+=1', [{name: 'MSG', construct: 'declare-i'}]],
    ['declare -i MSG-=1', [{name: 'MSG', construct: 'declare-i'}]],
    ['declare -i y+=MSG', [{name: 'MSG', construct: 'declare-i'}]],
  ] as const)('handles arithmetic assignment and comparison operators in %s', (command, expected) => {
    const result = classifyShellCodePosition({command, workflowDataNames});

    expect(result.matches).toEqual(expected);
  });

  it('keeps the command word after nested arithmetic', () => {
    const result = classifyShellCodePosition({
      command: 'eval $((1+(2))) "$MSG"',
      workflowDataNames,
    });

    expect(result.matches).toEqual([{name: 'MSG', construct: 'eval'}]);
  });

  it('does not treat a redirection target as an eval argument', () => {
    const result = classifyShellCodePosition({
      command: 'eval > "$MSG"',
      workflowDataNames,
    });

    expect(result.matches).toEqual([]);
  });

  it('does not infer a dynamic command head', () => {
    const result = classifyShellCodePosition({
      command: '$(printf eval) "$MSG"',
      workflowDataNames,
    });

    expect(result.matches).toEqual([]);
  });

  it.each([
    ['cat <<EOF\neval "$MSG"\nEOF', []],
    ['cat <<-EOF\neval "$MSG"\nEOF', []],
    ['(( echo "$MSG" ))', []],
    ["(( MSG + arr['k'] ))", [{name: 'MSG', construct: 'arithmetic'}]],
    ['if true; then eval "$MSG"; fi', [{name: 'MSG', construct: 'eval'}]],
    ['echo $((1 + (MSG)))', [{name: 'MSG', construct: 'arithmetic'}]],
    [
      String.raw`eval \
"$MSG"`,
      [{name: 'MSG', construct: 'eval'}],
    ],
  ] as const)('uses shell lexical state for %s', (command, expected) => {
    const result = classifyShellCodePosition({command, workflowDataNames});

    expect(result.matches).toEqual(expected);
  });
});
