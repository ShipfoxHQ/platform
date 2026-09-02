const TEST_VCS_REJECTION_COOLDOWN_WAIT_SECONDS = 2;

export const ON_REJECTION_WORKFLOW = `
name: Renewable Git on rejection
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  build:
    checkout:
      permissions:
        contents: write
      persist-credentials: true
    steps:
      - key: verify-primary-checkout
        run: |
          test -d .git
          command -v git-credential-shipfox
          test -n "$GIT_CONFIG_GLOBAL"
          test -f "$GIT_CONFIG_GLOBAL"
          git config --global --list --show-origin
          git config --global --get-urlmatch credential.helper "$(git remote get-url origin)" || true
      - key: secondary-checkout
        checkout:
          connection: __TEST_VCS_CONNECTION__
          repository: __TEST_VCS_SECONDARY_REPOSITORY__
          ref: main
          path: secondary
          permissions:
            contents: read
          persist-credentials: true
      - key: use-renewed-credentials
        run: |
          if git -c http.extraHeader='X-Shipfox-Test-Vcs-Invalidate-Generation: primary-read' ls-remote origin main; then
            echo 'expected the invalidated primary credential to be rejected' >&2
            exit 1
          fi
          git ls-remote origin main
          if git -C secondary -c http.extraHeader='X-Shipfox-Test-Vcs-Invalidate-Generation: secondary-read' ls-remote origin main; then
            echo 'expected the invalidated secondary credential to be rejected' >&2
            exit 1
          fi
          git -C secondary ls-remote origin main
          git config --local commit.gpgsign false
          printf '\\nrenewed\\n' >> README.md
          git add README.md
          git commit -m "renewed credentials"
          sleep ${TEST_VCS_REJECTION_COOLDOWN_WAIT_SECONDS}
          if git -c http.extraHeader='X-Shipfox-Test-Vcs-Invalidate-Generation: primary-push' push origin HEAD:main; then
            echo 'expected the invalidated primary credential to be rejected' >&2
            exit 1
          fi
          git push origin HEAD:main
          test "$(git log -1 --format=%ae)" = "test-vcs@shipfox.test"
`;
