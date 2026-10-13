# Nightly headroom

`.github/workflows/headroom-nightly.yml` runs the full headroom sweep on a schedule and from **Run workflow**. When `tests/fixtures/headroom-worst.json` changes, the run commits that file and force-updates `bot/headroom-worst`, then opens or updates one pull request into `main`.

The pull request is opened with the workflow token, so GitHub leaves CI on that pull request waiting for a maintainer. The nightly run has already re-rendered the worst cases. After the push it posts commit status `headroom/nightly-verified` on the commit it just created. The status is `success` when that re-render passed and `failure` when it did not. The status link opens that nightly run. The pull request body names the status and includes the same link.

A changed fixture is still pushed when the re-render fails, so the failure status has that commit to land on. The sweep job stays red. When the fixture is unchanged, the run does not push and does not post a status. The workflow does not approve workflow runs and does not merge the pull request. `ci.yml` stays read-only.

After this workflow is on `main`, verify it by running Headroom with **Run workflow**. If the fixture changed, open the bot pull request and confirm `headroom/nightly-verified` on the head commit. The details link should be that run. If the log says the worst cases were unchanged, there is no new commit and no new status.
