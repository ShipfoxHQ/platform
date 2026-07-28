# Cloudflare Pages lifecycle

The [preview workflow](../../.github/workflows/preview.yml) builds each app from
one exact Git commit. The [deploy workflow](../../.github/workflows/deploy.yml)
publishes previews, staging, or production. CI can call it. A maintainer can
start it from `main`.
Cloudflare Pages hosts the files. It does not build source code.

## Publication rules

| Source | Build | Deploy | Result |
| --- | --- | --- | --- |
| Pull request | Automatic | Automatic for branches in this repository | Immutable commit URL |
| Fork pull request event | Automatic, without secrets | Maintainer approval | Workflow artifact, then immutable commit URL |
| CI on `main` | After required checks | Production | Stable `main` catalog |
| Manual deploy run from `main` | Current `main` or approved artifact | Preview or staging | Configured environment |

An old pull request run stops when a new commit arrives. Each good deploy stores
the full commit SHA in the metadata file. GitHub links to the fixed URL. A
branch alias is only a short link.

Main CI gives each push one first-in, first-out slot before checks start.
Production deploys use a second non-canceling queue. A newer pending run does
not replace an older one. Only main CI can publish production.

The Pages config lists each app, output folder, build inputs, check paths, local
test command, and metadata file. This keeps app details out of the workflows.

## Approve a fork preview

The pull request workflow builds fork code without repository secrets. It runs
the artifact and browser checks. It uploads one artifact named for the pull
request and exact head SHA.

Check the pull request changes and the successful preview build before
promotion. Start **Deploy** from the `main` branch. Select
`preview` and enter the open pull request number.

The deploy workflow checks the current pull request head. It finds the matching
unexpired artifact and uses deployment tooling from `main`. It does not check
out or execute fork source with the Cloudflare token. A moved or closed pull
request stops the deployment.

## Failure and stale commits

The build and checks run before upload. A failed build or check stops all
uploads. A provider error can still publish some apps in a multi-app plan.
Every successful upload is registered and checked even when another app fails.
The aggregate workflow stays failed.

The deploy workflow checks a pull request head before and after upload. If it
changed, the run is not current. The old fixed URL stays valid for its own
commit.

If a new build fails, keep the last good URL. Do not use it for the failed
commit. Run the workflow again after the pull request is fixed.

Manual staging runs always resolve the current `main` SHA. The workflow rejects
runs started from another Git ref. Reusable stable deployments also reject
commits that are not merged into `main`.

## Retention

The policy keeps deploys for open pull requests and for 30 days after close.
The scheduled cleanup work belongs to
[ENG-1283](https://linear.app/shipfox/issue/ENG-1283/add-cloudflare-storybook-preview-retention-and-cleanup).
It must keep the newest deploy for each open `pr-<number>` branch. It must never
delete staging or production deploys.

## Recovery and rollback

Use the fixed URL for recovery. It names one commit. It does not change when the
pull request alias moves.

1. For a failed pull request deploy, keep the last good URL from the workflow
   summary.
2. For a broken production catalog, stop promotion by disabling the deploy
   workflow or removing the bad change.
3. Revert the bad main change. After CI passes, deploy again.
4. Check the metadata, paths, and app shell.
5. Keep the Cloudflare project and last good deploy during rollback.

Record one rollback drill in a non-production Pages project before production
is gated. Use a known good immutable URL, deploy a reversible change to staging,
revert it on `main`, and confirm that the new staging metadata names the revert
commit.

## Local verification

Run these checks from the repository root:

```sh
mise exec -- turbo check type test --filter=@shipfox/storybook...
mise exec -- turbo check type test --filter=@shipfox/cloudflare-pages...
```
