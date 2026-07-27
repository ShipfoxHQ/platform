# Generated release PR CI

Changesets-generated release PRs use the fast CI path only when the repository-owned verifier reproduces their complete tree from the PR base revision. The release App identity and branch name narrow the candidate set; the regenerated tree comparison is the security boundary.

The fast path keeps the required `Static verification`, `Unit and story tests`, `E2E tests`, and `Build images` contexts successful. It runs frozen dependency installation, package-release policy checks and tests, and the complete publication-closure preflight. The unit/story suite, E2E suite, and application image matrix are intentionally skipped.

Any verification error, timeout, malformed result, source edit, or other mismatch fails closed to the normal CI path.

To force full CI for every PR temporarily, set the repository Actions variable `FORCE_FULL_CI` to `true`.

## Version-only commits on `main`

After a verified release PR merges, `CI` classifies the resulting `main`
commit from its GitHub pull request metadata and complete tree. The classifier
also checks the first parent revision. It does not trust the commit title,
branch, or author on its own.

When the tree matches the generated Changesets output:

- package-release verification and publication preflight still run;
- unit and Storybook tests, E2E tests, and Packer runner candidates are skipped;
- each application image gets an immutable full-revision tag on its first
  successful build, and reruns or version-only commits retag from that digest;
- the application-release manifest records the prior image revision in
  `artifactReuse`.

If GitHub metadata, the parent revision, or generated tree cannot be resolved,
the workflow uses normal validation. The version-only path also verifies every
parent application-image revision tag before selecting reuse. If any tag is
missing or does not resolve to an immutable digest, the current release commit
runs the full `main` pipeline and builds its images once. It never substitutes
an older image revision. Ordinary source, configuration, dependency,
Dockerfile, Packer, workflow, or application metadata changes also keep the
full `main` pipeline.
