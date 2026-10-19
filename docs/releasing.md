# Releasing pi-links

## One-time setup

Push `.github/workflows/publish.yml` to `waqiju/pi-links` before configuring npm.
In the npm package settings for `pi-links`, add a GitHub Actions trusted publisher:

| Field | Value |
| --- | --- |
| Organization or user | `waqiju` |
| Repository | `pi-links` |
| Workflow filename | `publish.yml` (not the full path) |
| Environment name | Leave empty; the workflow uses no GitHub environment |
| Allowed actions | Enable direct publishing with `npm publish` |

If the UI offers stage-only access, do not use it for this workflow: staged releases require a separate human approval. Initial trust configuration may require account verification; subsequent direct publishes use short-lived OIDC credentials.

No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. Keep account 2FA enabled. Restrict who can push `v*` tags using GitHub repository rules, and review changes to the publishing workflow. Anyone allowed to push a release tag can trigger publication. Use GitHub-hosted runners; this workflow runs on `ubuntu-latest`.

Reference: https://docs.npmjs.com/trusted-publishers/

## Release

Start with reviewed changes committed, a clean working tree, and a passing CI run. Configure trusted publishing before creating the first new release tag.

```sh
git switch main
git pull --ff-only
npm ci
npm run check
npm test
npm version patch
git push origin main
git push origin "v$(node -p 'require("./package.json").version')"
```

`npm version patch` updates both manifests, creates a version commit and tags it. From `0.1.0`, this produces `0.1.1`. Use `minor` or `major` when appropriate. Do not reuse `0.1.0`, which is already published.

Pushing the version tag starts `.github/workflows/publish.yml`, which validates the package and lockfile versions against the tag, installs dependencies, runs type checking and tests, checks package contents, and publishes with provenance. Prerelease versions are deliberately rejected to avoid accidentally setting `latest` to a prerelease. Ordinary branch pushes and pull requests do not publish.

Watch the Publish to npm workflow in GitHub Actions, then verify:

```sh
npm view pi-links version --registry=https://registry.npmjs.org
```

npm may take a few minutes to make a new release available. Once available, smoke-test `pi install npm:pi-links` in an isolated Pi profile. Gallery indexing is separate from npm publication.

## Failures

- Authentication failure: check the exact trusted publisher owner, repository, filename, empty environment, and permission for direct `npm publish`. Do not use `npm whoami` as an OIDC preflight; it is not an OIDC publish operation.
- Tests fail: fix and release a new reviewed version; do not bypass checks.
- Network failure before publication: check npm first, then rerun the failed workflow if the version is not published.
- Version already exists: never overwrite or unpublish it to retry. If it is correct, no further publication is needed; otherwise release a new version.

The initial setup must be validated by an actual future release. Local tests cannot verify npm's OIDC trust configuration.
