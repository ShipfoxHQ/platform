import assert from 'node:assert/strict';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {remarkGeneratedComponents} from './remark-generated-components';

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

const fixtures = [
  {
    directory: ['content', 'docs', 'reference'],
    importStatement:
      "import {TopLevelFields} from '../../generated/reference/workflow-schema.mdx';",
    component: 'TopLevelFields',
    fact: '| `name` |',
  },
  {
    directory: ['content', 'docs', 'reference'],
    importStatement:
      "import ContextAvailability from '../../generated/reference/context-availability.mdx';",
    component: 'ContextAvailability',
    fact: '| Workflow key | Available contexts |',
  },
  {
    directory: ['content', 'docs', 'reference'],
    importStatement: "import ModelProviders from '../../generated/reference/model-providers.mdx';",
    component: 'ModelProviders',
    fact: '| Provider | `provider` ID |',
  },
  {
    directory: ['content', 'docs', 'integrations', 'github'],
    importStatement:
      "import GithubEvents from '../../../generated/integrations/github/events.mdx';",
    component: 'GithubEvents',
    fact: '### `push`',
  },
  {
    directory: ['content', 'docs', 'integrations', 'github'],
    importStatement: "import GithubTools from '../../../generated/integrations/github/tools.mdx';",
    component: 'GithubTools',
    fact: '### issues',
  },
] as const;

test('loads declared generated components with their machine-readable facts', async () => {
  for (const fixture of fixtures) {
    const tree = {
      type: 'root',
      children: [
        {type: 'mdxjsEsm', value: fixture.importStatement},
        {type: 'mdxJsxFlowElement', name: fixture.component, attributes: [], children: []},
      ],
    };

    await remarkGeneratedComponents()(tree, {dirname: join(docsRoot, ...fixture.directory)});

    const element = tree.children[1];
    assert.ok(element && typeof element === 'object' && 'data' in element);
    const text =
      element.data &&
      typeof element.data === 'object' &&
      '_stringify' in element.data &&
      element.data._stringify &&
      typeof element.data._stringify === 'object' &&
      'text' in element.data._stringify
        ? element.data._stringify.text
        : undefined;
    assert.equal(typeof text, 'string');
    if (typeof text !== 'string') throw new Error('Generated component text was not serialized.');
    assert.ok(text.includes(fixture.fact));
  }
});
