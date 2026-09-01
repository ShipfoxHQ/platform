#!/usr/bin/env sh
# Bootstraps local-development Gitea over HTTP: users, org access, webhook, and seed repos.
# Idempotent, so gitea-init can re-run it safely.
#
# Gitea has no API for the first admin because every admin API needs an existing
# admin, so that one user is created through the CSRF-protected sign-up form.
set -eu

GITEA_URL="${GITEA_URL:-http://localhost:3000}"
ADMIN_USER="${GITEA_ADMIN_USERNAME:-gitea-admin}"
ADMIN_PASSWORD="${GITEA_ADMIN_PASSWORD:-gitea-admin-dev-password}"
ADMIN_EMAIL="${GITEA_ADMIN_EMAIL:-gitea-admin@shipfox.local}"
# Username and password match apps/api/.env; dev uses the password as the Basic-auth secret.
BOT_USER="${GITEA_SERVICE_USERNAME:-shipfox-bot}"
BOT_PASSWORD="${GITEA_SERVICE_TOKEN:-shipfox-bot-dev-password}"
BOT_EMAIL="${GITEA_BOT_EMAIL:-shipfox-bot@shipfox.local}"
ORG="${GITEA_ORG:-shipfox}"
# Scoped teams that include every repo, current and future. Keeping code read access
# and issue-comment write access separate means a leaked bot credential cannot push
# code or manage the org.
READ_TEAM="shipfox-readers"
ISSUE_WRITE_TEAM="shipfox-issue-writers"
# Webhook setup uses admin credentials because the service account's scoped teams do not grant
# org-hook administration.
WEBHOOK_TARGET_URL="${GITEA_WEBHOOK_TARGET_URL:-http://host.docker.internal:16101/webhooks/integrations/gitea}"
WEBHOOK_SECRET="${GITEA_WEBHOOK_SECRET:-shipfox-gitea-dev-webhook-secret}"
SEED_DIR="${SEED_DIR:-/seed}"
COOKIE_JAR="$(mktemp)"
# set -e aborts on any failed step, so clean the cookie jar from a trap rather than
# a trailing rm that an early exit would skip.
trap 'rm -f "$COOKIE_JAR"' EXIT

admin_api() {
  method="$1"
  path="$2"
  body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$GITEA_URL/api/v1$path" \
      -u "$ADMIN_USER:$ADMIN_PASSWORD" \
      -H 'Content-Type: application/json' \
      -d "$body"
  else
    curl -fsS -X "$method" "$GITEA_URL/api/v1$path" \
      -u "$ADMIN_USER:$ADMIN_PASSWORD"
  fi
}

# HTTP status of an authenticated GET, used as an existence probe so each step can
# skip work it already did on a previous run.
admin_status() {
  curl -s -o /dev/null -w '%{http_code}' \
    -u "$ADMIN_USER:$ADMIN_PASSWORD" "$GITEA_URL/api/v1$1"
}

# Gitea promotes the first registered user to site admin; the form requires a CSRF echo.
if [ "$(admin_status "/users/$ADMIN_USER")" = "200" ]; then
  echo "Gitea admin '$ADMIN_USER' already exists, skipping sign-up."
else
  signup_page="$(curl -fsS -c "$COOKIE_JAR" "$GITEA_URL/user/sign_up")"
  csrf="$(printf '%s' "$signup_page" \
    | grep -o 'name="_csrf"[^>]*value="[^"]*"' \
    | head -n1 \
    | sed 's/.*value="\([^"]*\)".*/\1/')"
  if [ -z "$csrf" ]; then
    csrf="$(grep _csrf "$COOKIE_JAR" | awk '{print $NF}' | head -n1)"
  fi

  curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -o /dev/null \
    -X POST "$GITEA_URL/user/sign_up" \
    --data-urlencode "_csrf=$csrf" \
    --data-urlencode "user_name=$ADMIN_USER" \
    --data-urlencode "email=$ADMIN_EMAIL" \
    --data-urlencode "password=$ADMIN_PASSWORD" \
    --data-urlencode "retype=$ADMIN_PASSWORD"
  echo "Created Gitea site admin '$ADMIN_USER'."
fi

if [ "$(admin_status "/users/$BOT_USER")" = "200" ]; then
  echo "Bot user '$BOT_USER' already exists, skipping."
else
  admin_api POST /admin/users "$(jq -n \
    --arg username "$BOT_USER" \
    --arg email "$BOT_EMAIL" \
    --arg password "$BOT_PASSWORD" \
    '{username: $username, email: $email, password: $password, must_change_password: false}')" \
    >/dev/null
  echo "Created bot user '$BOT_USER'."
fi

# Demo org owned by the admin. Public so it is easy to browse, while its repos stay
# private so the checkout path genuinely exercises Basic auth.
if [ "$(admin_status "/orgs/$ORG")" = "200" ]; then
  echo "Org '$ORG' already exists, skipping."
else
  admin_api POST /orgs "$(jq -n --arg org "$ORG" '{username: $org, visibility: "public"}')" >/dev/null
  echo "Created org '$ORG'."
fi

# Read-only team scoped to repo code only (clone + contents read), covering all
# current and future repos. Look it up by name first so a re-run reuses it.
team_id="$(admin_api GET "/orgs/$ORG/teams" | jq -r --arg name "$READ_TEAM" '.[] | select(.name == $name) | .id' | head -n1)"
if [ -z "$team_id" ]; then
  team_id="$(admin_api POST "/orgs/$ORG/teams" "$(jq -n --arg name "$READ_TEAM" \
    '{name: $name, permission: "read", includes_all_repositories: true, units: ["repo.code"]}')" \
    | jq -r '.id')"
  echo "Created read team '$READ_TEAM' (#$team_id)."
fi
# PUT is idempotent: re-adding an existing member is a no-op.
admin_api PUT "/teams/$team_id/members/$BOT_USER" >/dev/null
echo "Bot user '$BOT_USER' is a member of read team '$READ_TEAM'."

# Issue tools need to read issues and write comments, but do not need repository
# code write access. Keep that capability on its own unit-scoped team.
issue_team_id="$(admin_api GET "/orgs/$ORG/teams" | jq -r --arg name "$ISSUE_WRITE_TEAM" '.[] | select(.name == $name) | .id' | head -n1)"
if [ -z "$issue_team_id" ]; then
  issue_team_id="$(admin_api POST "/orgs/$ORG/teams" "$(jq -n --arg name "$ISSUE_WRITE_TEAM" \
    '{name: $name, permission: "write", includes_all_repositories: true, units: ["repo.issues"]}')" \
    | jq -r '.id')"
  echo "Created issue-write team '$ISSUE_WRITE_TEAM' (#$issue_team_id)."
fi
admin_api PUT "/teams/$issue_team_id/members/$BOT_USER" >/dev/null
echo "Bot user '$BOT_USER' is a member of issue-write team '$ISSUE_WRITE_TEAM'."

# Skip an existing hook with the same target so re-runs do not stack duplicate deliveries.
existing_hook="$(admin_api GET "/orgs/$ORG/hooks" \
  | jq -r --arg url "$WEBHOOK_TARGET_URL" '.[] | select(.config.url == $url) | .id' | head -n1)"
if [ -n "$existing_hook" ]; then
  echo "Org push webhook already registered (#$existing_hook), skipping."
else
  admin_api POST "/orgs/$ORG/hooks" "$(jq -n \
    --arg url "$WEBHOOK_TARGET_URL" \
    --arg secret "$WEBHOOK_SECRET" \
    '{type: "gitea", active: true, events: ["push"], config: {url: $url, content_type: "json", secret: $secret}}')" \
    >/dev/null
  echo "Registered org push webhook -> $WEBHOOK_TARGET_URL."
fi

# auto_init creates the default branch that seeded files commit to.
for repo_dir in "$SEED_DIR"/*/; do
  [ -d "$repo_dir" ] || continue
  repo="$(basename "$repo_dir")"

  if [ "$(admin_status "/repos/$ORG/$repo")" = "200" ]; then
    echo "Repo '$ORG/$repo' already exists, skipping creation."
  else
    admin_api POST "/orgs/$ORG/repos" "$(jq -n --arg name "$repo" \
      '{name: $name, private: true, auto_init: true, default_branch: "main"}')" >/dev/null
    echo "Created repo '$ORG/$repo'."
  fi

  # Upload every seeded file via the contents API. A file that is already present
  # (including the auto-init README) is left untouched so re-runs do not churn it.
  find "$repo_dir" -type f | while read -r file; do
    rel="${file#"$repo_dir"}"
    if [ "$(admin_status "/repos/$ORG/$repo/contents/$rel")" = "200" ]; then
      continue
    fi
    content="$(base64 <"$file" | tr -d '\n')"
    admin_api POST "/repos/$ORG/$repo/contents/$rel" "$(jq -n \
      --arg content "$content" \
      --arg message "Seed $rel" \
      '{content: $content, message: $message, branch: "main"}')" >/dev/null
    echo "  seeded $repo/$rel"
  done
done

echo "Gitea ready: org '$ORG', bot '$BOT_USER', repos seeded under $GITEA_URL/$ORG."
