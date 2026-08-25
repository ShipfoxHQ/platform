import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workflowsDirectory = resolve(packageDirectory, '../../../.github/workflows');

function readWorkflow(name: string) {
  return readFile(resolve(workflowsDirectory, name), 'utf8');
}

describe('package release workflows', () => {
  test('cancels superseded release-PR updates without publication authority', async () => {
    const workflow = await readWorkflow('update-release-pr.yml');

    assert.ok(workflow.includes('cancel-in-progress: true'));
    assert.ok(workflow.includes('package-release-workflow.mjs plan'));
    assert.ok(workflow.includes("has_changesets == 'true'"));
    assert.ok(workflow.includes('version: pnpm exec changeset version'));
    assert.ok(!workflow.includes('release:publish'));
    assert.ok(!workflow.includes('id-token: write'));
  });

  test('publishes only exact merged release revisions in non-cancelable isolation', async () => {
    const workflow = await readWorkflow('publish-packages.yml');

    assert.ok(workflow.includes('types: [closed]'));
    assert.ok(workflow.includes('workflow_dispatch:'));
    assert.ok(workflow.includes('Exact merged release revision to recover'));
    assert.ok(workflow.includes('cancel-in-progress: false'));
    assert.ok(workflow.includes('ref: $' + '{{ needs.authorize-release.outputs.revision }}'));
    assert.ok(workflow.includes('verify-generated-release'));
    assert.ok(workflow.includes('SHIPFOX_PUBLICATION_REGISTRY_BASE:'));
    assert.ok(workflow.includes('NPM_CONFIG_PROVENANCE: "true"'));
    assert.ok(workflow.includes('package-release-workflow.mjs authorize'));
    assert.ok(workflow.includes('steps.release-app-token.outputs.app-slug'));
    assert.ok(workflow.includes('gh api "/users/$' + '{RELEASE_APP_SLUG}[bot]" --jq .id'));
    assert.ok(workflow.includes('--release-app-id "$RELEASE_BOT_USER_ID"'));
  });
});
