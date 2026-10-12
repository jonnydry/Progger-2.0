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
  assert.match(
    workflow,
    /permissions:\n  contents: write\n  pull-requests: write\n/,
  );
  assert.doesNotMatch(workflow, /actions: write/);
  assert.match(workflow, /npm run test:headroom-check/);
  assert.match(workflow, /HEADROOM_CHECK_RESULT/);
  assert.match(workflow, /the render check did not record a result/);
  assert.match(workflow, /per-push render check ran against that file/);
  assert.match(workflow, /GITHUB_TOKEN does not trigger CI/);
  assert.match(
    workflow,
    /Allow GitHub Actions to create and approve pull requests/,
  );
  assert.match(workflow, /pending Jonny's OK/);
  const checkAt = workflow.indexOf('npm run test:headroom-check');
  const prAt = workflow.indexOf('gh pr create');
  assert.ok(checkAt > 0 && prAt > checkAt);
  assert.match(workflow, /if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /branch="bot\/headroom-worst-\$\{GITHUB_RUN_ID\}"/);
  assert.match(workflow, /git push origin "refs\/heads\/\$\{branch\}:refs\/heads\/\$\{branch\}"/);
  assert.match(workflow, /gh pr create \\\n\s+--base main/m);
  assert.equal(workflow.match(/git push/g)?.length, 1);
  assert.doesNotMatch(workflow, /git push origin main/);
  assert.doesNotMatch(workflow, /git push origin HEAD/);
});
