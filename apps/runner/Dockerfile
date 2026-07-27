# syntax=docker/dockerfile:1

# "Build outside Docker, ingest dist": `shipfox-docker --setup-context` prunes
# the workspace and overlays the turbo-cached dist/. The build stage installs
# the pruned workspace and runs `pnpm deploy` to extract @shipfox/runner's
# production dependency closure into a self-contained tree; the runtime stage
# ships only that, so the dev-only tools/* workspace packages (biome, vitest,
# the swc/playwright toolchains) never reach the image. Docker never compiles
# TypeScript.

ARG NODE_VERSION=24.16.0
ARG PNPM_VERSION=11.6.0

# The official node image (Debian/glibc) carries corepack and a clean pnpm store.
# The runner's prod closure is JS + wasm plus agent optional native payloads:
# pi's clipboard addon and the Claude Agent SDK's platform Claude Code binary.
# Both use glibc prebuilds on linux-x64, so /prod is portable to the Ubuntu runtime below.
FROM node:${NODE_VERSION}-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
# Manifests + lockfile first (out/full carries the source but not the lockfile).
COPY out/json/ ./
COPY out/full/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@shipfox/runner deploy --prod --legacy \
      --store-dir=/pnpm/store --config.strict-peer-dependencies=false /prod

# Runtime stage: Ubuntu (latest LTS), not the slim node base, because the runner
# is a job executor. It checks out repositories and runs arbitrary user shell and
# agent steps, so it should look like the CI environment users expect (à la
# GitHub's ubuntu-latest): a glibc userland with the common system tools present.
# The Node closure stays production-only (pnpm deploy --prod above); it is the OS
# layer that is intentionally fuller here.
FROM ubuntu:26.04 AS runtime
ENV NODE_ENV=production

# Match the UTF-8 environment user steps expect from ubuntu-latest: the Ubuntu
# base leaves LANG unset, so tooling falls back to the byte-wise C locale and
# mishandles non-ASCII. C.UTF-8 is built into glibc, so it needs no `locales`
# package; a step can still override LANG for its own command.
ENV LANG=C.UTF-8

# System tooling the runner and the user steps it runs commonly need:
#  - git: clones the repository for each job (the checkout step fails as
#    `git_unavailable` without it); openssh-client covers git-over-ssh.
#  - ca-certificates: TLS trust for git/curl/wget HTTPS (the API client uses
#    Node's own bundle, but these system tools use the OS store).
#  - curl/wget, the archive tools, and jq: what user scripts reach for constantly.
#  - build-essential + python3 + pkg-config: node-gyp and native build steps.
#  - ripgrep (rg) + fd-find (fd): the pi agent's grep/find tools shell out to
#    these. On PATH they let pi use the system binaries instead of downloading
#    rg/fd from GitHub on first use. fd-find installs the binary as `fdfind`, so
#    it is symlinked to `fd` after the install.
#  - sudo: user steps get passwordless root inside the container, matching the
#    GitHub ubuntu-latest environment (the container itself is the isolation
#    boundary; see the sudoers drop-in below).
#  - tini: PID 1. The runner spawns each user shell/agent step in its own
#    detached process group; a step that orphans a grandchild re-parents it to
#    PID 1, and Node would not reap it. tini reaps those zombies over the
#    runner's long lifetime and forwards signals to its graceful-shutdown
#    handlers.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        git \
        openssh-client \
        tar \
        gzip \
        xz-utils \
        bzip2 \
        zip \
        unzip \
        jq \
        build-essential \
        python3 \
        pkg-config \
        ripgrep \
        fd-find \
        sudo \
        tini \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s "$(command -v fdfind)" /usr/local/bin/fd

# Node itself: copy the exact, pinned binary from the official image rather than
# add an apt repo, so the runtime Node matches the build stage byte-for-byte and
# stays GPG-verified upstream. The bin/ wrappers are symlinks into node_modules,
# so recreate them after copying the two real trees.
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack

WORKDIR /app

# Run as the unprivileged shipfox user by default, with passwordless sudo for the
# user steps that need root (à la ubuntu-latest; the container is the isolation
# boundary). Unlike the api the runner writes at runtime, so the user owns a home
# directory: the pi coding agent persists its config under $HOME/.pi, and per-job
# workspaces and shell scripts are created under the OS temp directory.
RUN groupadd --system shipfox \
    && useradd --system --gid shipfox --create-home --home-dir /home/shipfox shipfox \
    && echo 'shipfox ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/shipfox \
    && chmod 0440 /etc/sudoers.d/shipfox
ENV HOME=/home/shipfox

COPY --from=build /prod ./

USER shipfox

# The build/promotion workflows pass revision/created as build args.
ARG IMAGE_SOURCE="https://github.com/ShipfoxHQ/shipfox"
ARG IMAGE_REVISION
ARG IMAGE_CREATED
ARG BUILD_NUMBER
ARG RUNNER_VERSION
LABEL org.opencontainers.image.title="@shipfox/runner" \
      org.opencontainers.image.description="Shipfox runner" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source=$IMAGE_SOURCE \
      org.opencontainers.image.revision=$IMAGE_REVISION \
      org.opencontainers.image.created=$IMAGE_CREATED
ENV IMAGE_REVISION=$IMAGE_REVISION \
    IMAGE_CREATED=$IMAGE_CREATED \
    BUILD_NUMBER=$BUILD_NUMBER \
    RUNNER_VERSION=$RUNNER_VERSION

# tini as PID 1; --enable-source-maps maps stack traces back to TypeScript.
# OpenTelemetry is started in-process by startRunner(), so it needs no preload
# flag. The flag stays on the entrypoint command (not NODE_OPTIONS) so it applies
# to the runner only, not to the user step processes it spawns.
ENTRYPOINT ["tini", "--"]
CMD ["node", "--enable-source-maps", "./dist/index.js"]
