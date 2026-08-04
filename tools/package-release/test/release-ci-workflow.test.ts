import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(packageDirectory, '../../../.github/workflows/ci.yml');
const mainRefConditionPattern = /github\.ref == 'refs\/heads\/main'/;

function readWorkflow() {
  return readFile(workflowPath, 'utf8');
}

describe('generated release CI path', () => {
  test('uses deterministic classification only for release PR fixture data', async () => {
    const workflow = await readWorkflow();

    assert.ok(workflow.includes('release-classification:'));
    assert.ok(workflow.includes('--base "$BASE_SHA"'));
    assert.ok(workflow.includes('--head "$HEAD_SHA"'));
    assert.ok(workflow.includes('steps.release-app-token.outputs.app-slug'));
    assert.ok(workflow.includes('gh api "/users/$' + '{RELEASE_APP_SLUG}[bot]" --jq .id'));
    assert.ok(workflow.includes('--release-app-id "$RELEASE_BOT_USER_ID"'));
    assert.ok(workflow.includes('generated_release=false'));
    assert.ok(workflow.includes('classification" == generated-release'));
  });

  test('runs normal CI for normal, malformed, and main-push fixture conditions', async () => {
    const workflow = await readWorkflow();

    assert.ok(workflow.includes('mode=normal'));
    assert.ok(workflow.includes("needs.release-mode.outputs.mode == 'normal'"));
    assert.ok(
      workflow.includes(
        "needs.release-mode.result != 'success' || needs.release-mode.outputs.mode == 'normal'",
      ),
    );
  });

  test('classifies version-only main commits and reuses immutable image digests', async () => {
    const workflow = await readWorkflow();
    const parsedWorkflow = parse(workflow);
    const releaseClassification = parsedWorkflow.jobs['release-classification'];
    const imageClassification = parsedWorkflow.jobs['release-image-classification'];

    assert.ok(workflow.includes('classify-main'));
    assert.ok(workflow.includes('package-release-workflow.mjs classify-main'));
    assert.ok(workflow.includes('release-mode:'));
    assert.equal(releaseClassification.permissions, undefined);
    assert.equal(imageClassification.permissions.packages, 'read');
    assert.match(imageClassification.if, mainRefConditionPattern);
    assert.ok(workflow.includes('mode=version-only-main'));
    assert.ok(workflow.includes('version_only_previous_revision'));
    assert.ok(workflow.includes('steps.classify-images.outputs.version_only_main'));
    assert.ok(workflow.includes('verify-image-reuse'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/api'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/client'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/provisioner-docker'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/provisioner-ec2'));
    assert.ok(workflow.includes('--image-repository ghcr.io/shipfoxhq/runner'));
    assert.ok(workflow.includes('Reuse previous application image digest'));
    assert.ok(workflow.includes("needs.release-mode.outputs.mode == 'version-only-main'"));
    assert.ok(
      workflow.includes(
        "needs.release-mode.outputs.mode == 'version-only-main' && needs.external-package-contracts.result == 'skipped'",
      ),
    );
    assert.ok(
      workflow.includes(
        'previous_reference="$APPLICATION_IMAGE_REPOSITORY:revision-$PREVIOUS_REVISION"',
      ),
    );
    assert.ok(workflow.includes('for tag in "revision-$GITHUB_SHA" "sha-$' + '{GITHUB_SHA:0:7}"'));
    assert.ok(workflow.includes('revision-$GITHUB_SHA'));
    assert.ok(workflow.includes('Claim immutable application image revision tag'));
    assert.ok(workflow.includes('Retag existing application image for this revision'));
    assert.ok(!workflow.includes('previous_reference="$APPLICATION_IMAGE_REPOSITORY:sha-'));
    assert.ok(workflow.includes('oras tag "$APPLICATION_IMAGE_REPOSITORY@$digest"'));
    assert.ok(workflow.includes('--reuse-from-revision "$PREVIOUS_REVISION"'));
    assert.ok(workflow.includes('application image rebuilds, and Packer runner candidates'));
  });

  test('keeps required checks successful when the image matrix is intentionally skipped', async () => {
    const workflow = await readWorkflow();

    assert.ok(workflow.includes('name: Static verification'));
    assert.ok(workflow.includes('name: Unit and story tests'));
    assert.ok(workflow.includes('name: E2E tests'));
    assert.ok(workflow.includes('name: Build images'));
    assert.ok(
      workflow.includes('needs.release-mode.outputs.mode }}" = "generated-release"') &&
        workflow.includes('needs.build-image.result }}" = "skipped"'),
    );
  });
});
