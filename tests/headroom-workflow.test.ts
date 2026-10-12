import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflowDir = new URL('../.github/workflows/', import.meta.url);
const workflow = readFileSync(new URL('headroom-nightly.yml', workflowDir), 'utf8');
const ci = readFileSync(new URL('ci.yml', workflowDir), 'utf8');

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
  assert.match(workflow, /branch="bot\/headroom-worst"/);
  assert.doesNotMatch(workflow, /GITHUB_RUN_ID/);
  assert.match(
    workflow,
    /git push --force origin "HEAD:refs\/heads\/bot\/headroom-worst"/,
  );
  assert.match(workflow, /gh pr list --head "bot\/headroom-worst" --base main --state open/);
  assert.match(workflow, /gh pr edit "\$number" --body "\$body"/);
  assert.match(workflow, /gh pr create \\\n\s+--base main/m);
  assert.match(workflow, /--head "bot\/headroom-worst"/);
  assert.deepEqual(workflow.match(/git push[^\n]*/g), [
    'git push --force origin "HEAD:refs/heads/bot/headroom-worst"',
  ]);
  assert.doesNotMatch(workflow, /git push origin main/);
  assert.doesNotMatch(workflow, /git push origin HEAD/);
});

void test('only the nightly workflow can open pull requests', () => {
  assert.match(ci, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(ci, /pull-requests:/);
  assert.doesNotMatch(ci, /contents: write/);
  const files = readdirSync(workflowDir).filter((name) => name.endsWith('.yml'));
  assert.ok(files.includes('ci.yml'));
  assert.ok(files.includes('headroom-nightly.yml'));
  for (const name of files) {
    const text = readFileSync(new URL(name, workflowDir), 'utf8');
    if (name === 'headroom-nightly.yml') {
      assert.match(text, /pull-requests: write/);
      continue;
    }
    assert.doesNotMatch(text, /pull-requests:/, name);
  }
});
