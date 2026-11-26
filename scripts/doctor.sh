#!/bin/bash
# Environment health check. Exit code = number of failed checks.
fail=0
ok()   { echo "✔ $1"; }
bad()  { echo "✘ $1 — $2"; fail=$((fail + 1)); }
skip() { echo "– $1 (skipped: $2)"; }
check() { # check <name> <hint> <command...>
  local name=$1 hint=$2; shift 2
  if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name" "$hint"; fi
}
fresh() { [ -f "$1" ] && [ $(( $(date +%s) - $(stat -c %Y "$1") )) -le "$2" ]; }

check "claude installed" "rebuild the image" claude --version
check "claude logged in" "canopy login claude (or: tmux attach -t claude)" claude auth status
# gh auth status exits 0 even for an invalid token (gh 2.45), so make a real API call.
check "gh sees token" "check GH_TOKEN" gh api user
check "git author set" "set GIT_NAME/GIT_EMAIL or fix GH_TOKEN" git config --global user.email
check "settings.json valid" "see entrypoint log" jq empty ~/.claude/settings.json

if [ -n "${VAULT_REPO:-}" ]; then
  check "vault cloned" "check VAULT_REPO and token access" test -d ~/vault/.git
else
  skip "vault" "VAULT_REPO empty"
fi

IFS=',' read -ra repos <<< "${REPOS:-}"
for r in "${repos[@]}"; do
  r=${r//[[:space:]]/}
  r=${r%%#*}
  [ -n "$r" ] || continue
  name=$(basename "$r" .git)
  check "repo $name cloned" "check REPOS and token access" test -d ~/projects/"$name"/.git
done

# Same rule as the entrypoint: MCP set = only the listed servers; unset = Linear when its key is set.
mcp_on() { if [ -n "${MCP+x}" ]; then [[ ",$MCP," == *,$1,* ]]; else [ "$1" = linear ]; fi; }
if ! mcp_on linear; then
  skip "linear" "not enabled; canopy mcp add linear"
elif [ -z "${LINEAR_API_KEY:-}" ]; then
  skip "linear" "LINEAR_API_KEY empty"
else
  check "linear connected (claude mcp list)" "check LINEAR_API_KEY" \
    bash -c 'claude mcp list 2>/dev/null | grep -q "^linear-server:.*Connected"'
fi

if mcp_on figma; then
  check "figma connected (claude mcp list)" "canopy login figma" \
    bash -c 'claude mcp list 2>/dev/null | grep -q "^figma:.*Connected"'
else
  skip "figma" "not enabled; canopy mcp add figma"
fi

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  check "telegram token written" "restart the container" test -s ~/.claude/channels/telegram/.env
  check "telegram paired + allowlist" "canopy login telegram (or: telegram-pair.sh <code from the bot>)" \
    jq -e '(.allowFrom | length > 0) and .dmPolicy == "allowlist"' ~/.claude/channels/telegram/access.json
else
  skip "telegram" "TELEGRAM_BOT_TOKEN empty"
fi

used=$(df --output=pcent /root | tail -1 | tr -dc 0-9)
check "volume /root ${used}% used (limit 85%)" "find big dirs: du -xh -d2 ~ | sort -h | tail" test "$used" -lt 85

check "tmux session claude alive" "run start.sh" tmux has-session -t claude
[ -z "${TELEGRAM_BOT_TOKEN:-}" ] || check "tmux session typing alive" "run start.sh" tmux has-session -t typing

if [ -d ~/vault/.git ]; then
  check "tmux session sync alive" "run start.sh" tmux has-session -t sync
  # The sync loop pulls every 5 min (updates FETCH_HEAD) even when there is nothing to commit.
  check "vault synced in last 15 min" "see ~/vault-sync.log, tmux attach -t sync" fresh ~/vault/.git/FETCH_HEAD 900
  check "vault pushed (not ahead of remote)" "push failing? tmux attach -t sync" \
    test "$(git -C ~/vault rev-list --count '@{u}..HEAD' 2>/dev/null)" = 0
fi

echo
[ "$fail" -eq 0 ] && echo "All checks passed." || echo "$fail check(s) failed."
exit "$fail"
