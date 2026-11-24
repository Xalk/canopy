#!/bin/bash
# Container setup. Idempotent: safe to run on every start; user data in /root is never overwritten
# except the generated files (~/.claude/CLAUDE.md, ~/.claude/settings.json, authorized_keys, telegram .env).
set -euo pipefail

CANOPY=/opt/canopy
LOCAL=/root/canopy.local
log()  { echo "[canopy] $*"; }
warn() { echo "[canopy] WARN: $*" >&2; }

# 0. FOO_FILE=/path -> FOO=<file contents> (Docker secrets). Plain FOO still works (Railway).
for f in $(compgen -e | grep '_FILE$' || true); do
  [ -f "${!f}" ] || { echo "[canopy] ERROR: $f points to missing file ${!f}" >&2; exit 1; }
  export "${f%_FILE}=$(cat "${!f}")"
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
  [ -n "$r" ] || continue
  dir=~/projects/$(basename "$r" .git)
  [ -d "$dir/.git" ] && continue
  log "cloning $r"
  gh repo clone "$r" "$dir" || { warn "clone failed: $r"; continue; }
  [ -z "${DEFAULT_BRANCH:-}" ] || git -C "$dir" checkout "$DEFAULT_BRANCH" || warn "no branch $DEFAULT_BRANCH in $r"
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
if [ -n "${LINEAR_API_KEY:-}" ] && ! claude mcp get linear-server >/dev/null 2>&1; then
  claude mcp add -s user -t http linear-server https://mcp.linear.app/mcp \
    -H "Authorization: Bearer $LINEAR_API_KEY" || warn "linear mcp add failed"
fi

# 9. Telegram bot token for the channel plugin.
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  mkdir -p ~/.claude/channels/telegram
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TELEGRAM_BOT_TOKEN" > ~/.claude/channels/telegram/.env
  chmod 600 ~/.claude/channels/telegram/.env
fi

# SSH sessions don't inherit the container env and sshd overwrites /proc/1/environ,
# so save it (root-only, container fs, not the volume) for /etc/profile.d/canopy-env.sh.
mkdir -p /run/canopy
(umask 077; env -0 > /run/canopy/.env)

# 10. Agent + vault sync in tmux.
start.sh

# 11. Keep the container alive.
log "ready"
exec /usr/sbin/sshd -D -e
