import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/headroom-nightly.yml', import.meta.url),
  'utf8',
);

void test('the nightly sweep opens a bot pull request and does not push main', () => {
  assert.match(workflow, /^  schedule:$/m);
  assert.match(workflow, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(workflow, /^  pull_request:$/m);
  assert.match(workflow, /^  actions: write$/m);
  assert.match(workflow, /^  contents: write$/m);
  assert.match(workflow, /^  pull-requests: write$/m);
  assert.match(workflow, /uses: actions\/upload-artifact@v7/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(workflow, /if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /branch="bot\/headroom-worst-\$\{GITHUB_RUN_ID\}"/);
  assert.match(workflow, /git push origin "refs\/heads\/\$\{branch\}:refs\/heads\/\$\{branch\}"/);
  assert.match(workflow, /gh pr create \\\n\s+--base main/m);
  assert.equal(workflow.match(/git push/g)?.length, 1);
  assert.doesNotMatch(workflow, /git push origin main/);
  assert.doesNotMatch(workflow, /git push origin HEAD/);
});
