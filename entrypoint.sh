#!/bin/bash
# Container setup. Idempotent: safe to run on every start; user data in /root is never overwritten
# except the generated files (~/.claude/CLAUDE.md, ~/.claude/settings.json, authorized_keys, telegram .env).
set -euo pipefail

CANOPY=/opt/canopy
LOCAL=/root/canopy.local
log()  { echo "[canopy] $*"; }
warn() { echo "[canopy] WARN: $*" >&2; }

# 0. FOO_FILE=/path -> FOO=<file contents> (Docker secrets). Plain FOO still works (Railway).
#    Only canopy's own variables, so an unrelated *_FILE set by the platform can't stop the container.
for v in AUTHORIZED_KEYS GH_TOKEN LINEAR_API_KEY TELEGRAM_BOT_TOKEN GIT_NAME GIT_EMAIL; do
  f=${v}_FILE
  [ -n "${!f:-}" ] || continue
  [ -f "${!f}" ] || { echo "[canopy] ERROR: $f points to missing file ${!f}" >&2; exit 1; }
  export "$v=$(cat "${!f}")"
done

# 1. Required variables.
missing=()
for v in AUTHORIZED_KEYS GH_TOKEN; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "[canopy] ERROR: missing required variables: ${missing[*]} (see .env.example)" >&2
  exit 1
fi

# 2. SSH: key-only. Keys separated by newline or ';'. Host key lives in the volume.
mkdir -p ~/.ssh ~/.canopy/ssh
chmod 700 ~/.ssh
printf '%s\n' "$AUTHORIZED_KEYS" | tr ';' '\n' | sed '/^[[:space:]]*$/d' > ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
[ -f ~/.canopy/ssh/ssh_host_ed25519_key ] || ssh-keygen -q -t ed25519 -N '' -f ~/.canopy/ssh/ssh_host_ed25519_key

# 3. Git + GitHub.
gh auth setup-git
git config --global pull.rebase true
# Commit author: GIT_NAME/GIT_EMAIL, else the token's GitHub user with its noreply email.
if [ -z "${GIT_NAME:-}" ] || [ -z "${GIT_EMAIL:-}" ]; then
  # gh still runs --jq over the error body on 401, so trust only its exit code.
  if user=$(gh api user --jq '"\(.login) \(.id)"' 2>/dev/null); then
    read -r login id <<< "$user"
    GIT_NAME=${GIT_NAME:-$login}
    GIT_EMAIL=${GIT_EMAIL:-$id+$login@users.noreply.github.com}
  fi
fi
if [ -n "${GIT_NAME:-}" ] && [ -n "${GIT_EMAIL:-}" ]; then
  git config --global user.name "$GIT_NAME"
  git config --global user.email "$GIT_EMAIL"
else
  warn "no git author: set GIT_NAME/GIT_EMAIL or fix GH_TOKEN (commits and vault sync will fail)"
fi

# 4. Vault.
if [ -n "${VAULT_REPO:-}" ] && [ ! -d ~/vault/.git ]; then
  log "cloning vault $VAULT_REPO"
  gh repo clone "$VAULT_REPO" ~/vault || warn "vault clone failed"
fi

# 5. Project repos (first clone only: later starts never touch branches or node_modules).
mkdir -p ~/projects
IFS=',' read -ra repos <<< "${REPOS:-}"
for r in "${repos[@]}"; do
  r=${r//[[:space:]]/}
  branch=${DEFAULT_BRANCH:-}
  [[ $r != *#* ]] || { branch=${r#*#}; r=${r%%#*}; }  # owner/repo#branch
  [ -n "$r" ] || continue
  # A leading "-" would be read as an option by gh/git.
  [[ $r != -* && $branch != -* ]] || { warn "skipped suspicious repo entry: $r#$branch"; continue; }
  dir=~/projects/$(basename "$r" .git)
  [ -d "$dir/.git" ] && continue
  log "cloning $r"
  gh repo clone "$r" "$dir" || { warn "clone failed: $r"; continue; }
  [ -z "$branch" ] || git -C "$dir" checkout "$branch" || warn "no branch $branch in $r"
  [ ! -f "$dir/package-lock.json" ] || npm ci --prefix "$dir" || warn "npm ci failed in $r"
done

# 6. ~/.claude/CLAUDE.md and settings.json = base + local.
mkdir -p ~/.claude
{
  cat "$CANOPY/config/CLAUDE.base.md" "$CANOPY/config/telegram.md"
  [ ! -f ~/vault/CLAUDE.md ] || printf '\n## Vault\n@~/vault/CLAUDE.md\n'
  [ ! -f "$LOCAL/CLAUDE.local.md" ] || cat "$LOCAL/CLAUDE.local.md"
  # Written by the agent before fresh.sh; imported at the start of every session.
  printf '\n## Handoff from the previous session\n@~/.canopy/handoff.md\n'
} > ~/.claude/CLAUDE.md

dirs=$(for d in ~/vault ~/projects/*; do [ ! -d "$d" ] || echo "$d"; done | jq -R . | jq -sc .)
merge_settings() {
  # Deep merge left to right; arrays are concatenated, so local adds rules instead of replacing them.
  jq -s --argjson dirs "$dirs" '
    def merge($a; $b):
      if ($a|type) == "object" and ($b|type) == "object" then
        reduce ($b|keys_unsorted[]) as $k ($a; .[$k] = merge($a[$k]; $b[$k]))
      elif ($a|type) == "array" and ($b|type) == "array" then $a + $b | unique
      else $b end;
    reduce .[] as $x ({}; merge(.; $x))
    | .permissions.additionalDirectories = (.permissions.additionalDirectories + $dirs | unique)
  ' "$@"
}
if [ -f "$LOCAL/settings.local.json" ]; then
  merge_settings "$CANOPY/config/settings.base.json" "$LOCAL/settings.local.json" > ~/.claude/settings.json.tmp \
    || { warn "invalid $LOCAL/settings.local.json, using base only"; merge_settings "$CANOPY/config/settings.base.json" > ~/.claude/settings.json.tmp; }
else
  merge_settings "$CANOPY/config/settings.base.json" > ~/.claude/settings.json.tmp
fi
mv ~/.claude/settings.json.tmp ~/.claude/settings.json

# 7. Skills from the vault, linked one by one: ~/.claude/skills stays a real dir because Claude
#    writes its own synced skills there, and those must not end up in the vault.
mkdir -p ~/.claude/skills
find ~/.claude/skills -maxdepth 1 -xtype l -delete  # skills removed from the vault
for s in ~/vault/.claude/skills/*/; do
  [ ! -d "$s" ] || ln -sfn "${s%/}" ~/.claude/skills/
done

# 8. Telegram plugin + Linear MCP (best effort: a failure here must not block SSH access).
# Both commands are idempotent (no-op when already on disk / installed).
{ claude plugin marketplace add anthropics/claude-plugins-official >/dev/null \
  && claude plugin install telegram@claude-plugins-official >/dev/null; } || warn "telegram plugin install failed (see README)"
# MCP servers. When MCP is set (the CLI always sets it, "none" = nothing), exactly the listed servers
# are configured and the others removed, so `canopy mcp remove` is just an edit + restart.
# Without MCP (a hand-written .env), Linear is added whenever its key is set.
mcp_on() { if [ -n "${MCP+x}" ]; then [[ ",$MCP," == *,$1,* ]]; else [ "$1" = linear ]; fi; }
has_mcp() { claude mcp get "$1" >/dev/null 2>&1; }
drop_mcp() { [ -z "${MCP+x}" ] || ! has_mcp "$1" || claude mcp remove -s user "$1" >/dev/null || warn "removing $1 failed"; }
if mcp_on linear && [ -n "${LINEAR_API_KEY:-}" ]; then
  has_mcp linear-server || claude mcp add -s user -t http linear-server https://mcp.linear.app/mcp \
    -H "Authorization: Bearer $LINEAR_API_KEY" || warn "linear mcp add failed"
else
  drop_mcp linear-server
fi
# Figma uses OAuth: added here, authorized with `canopy login figma` (claude mcp login --no-browser).
if mcp_on figma; then
  has_mcp figma || claude mcp add -s user -t http figma https://mcp.figma.com/mcp || warn "figma mcp add failed"
else
  drop_mcp figma
fi

# 9. Telegram bot token for the channel plugin.
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  mkdir -p ~/.claude/channels/telegram
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TELEGRAM_BOT_TOKEN" > ~/.claude/channels/telegram/.env
  chmod 600 ~/.claude/channels/telegram/.env
  # React with 👀 the moment a message arrives (a plugin setting). A value you set yourself, "" included, is kept.
  access=~/.claude/channels/telegram/access.json
  if [ -f "$access" ] && ! jq -e 'has("ackReaction")' "$access" >/dev/null; then
    jq '.ackReaction = "👀"' "$access" > "$access.tmp" && chmod 600 "$access.tmp" && mv "$access.tmp" "$access"
  fi
fi

# SSH sessions don't inherit the container env and sshd overwrites /proc/1/environ,
# so save it (root-only, container fs, not the volume) for /etc/profile.d/canopy-env.sh.
mkdir -p /run/canopy
(umask 077; env -0 > /run/canopy/.env)

# 10. Agent + vault sync in tmux.
start.sh

# Tell Telegram the agent is back (after canopy up / update / a server reboot), once Claude had time to start.
(
  sleep 20
  if tmux has-session -t claude 2>/dev/null; then
    notify.sh "✅ canopy is up: the agent is ready"
  else
    notify.sh "❌ canopy started, but the agent session is not running. Run: canopy doctor"
  fi
) >/dev/null 2>&1 &

# 11. Keep the container alive.
log "ready"
exec /usr/sbin/sshd -D -e
