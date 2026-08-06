import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from '@shipfox/vitest/vi';

const calloutRuntimePath = /dist\/components\/callout\/index\.js$/;
const markdownRuntimePath = /dist\/components\/markdown\/index\.js$/;
const lineBreak = /\r?\n/;
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

describe('@shipfox/react-ui published subpath exports', () => {
  it('resolves Callout and Markdown through Node package exports', () => {
    const resolutions = execFileSync(
      process.execPath,
      [
        '--conditions=default',
        '--input-type=module',
        '-e',
        [
          "import {createRequire} from 'node:module';",
          "const require = createRequire(process.cwd() + '/package.json');",
          "await import('@shipfox/client-ui');",
          "console.log(require.resolve('@shipfox/react-ui/callout'));",
          "console.log(require.resolve('@shipfox/react-ui/markdown'));",
        ].join('\n'),
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        env: {...process.env, NODE_OPTIONS: ''},
      },
    );

    expect(resolutions.trim().split(lineBreak)).toEqual([
      expect.stringMatching(calloutRuntimePath),
      expect.stringMatching(markdownRuntimePath),
    ]);
  }, 15_000);
});
