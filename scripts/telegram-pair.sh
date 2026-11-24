#!/bin/bash
# telegram-pair.sh <code> - approve a Telegram pairing code and switch the bot to allowlist.
# Does what "/telegram:access pair <code>" + "policy allowlist" do, without an agent turn.
# Messages go to stdout; exit 2 = bad code format, 3 = code unknown or expired.
dir=~/.claude/channels/telegram
f=$dir/access.json
code=$(tr 'A-F' 'a-f' <<<"${1:-}")
[[ $code =~ ^[a-f0-9]{6}$ ]] || { echo "The code has 6 characters: digits and letters a-f."; exit 2; }
[ -f "$f" ] || { echo "No pairing request yet: send a message to the bot first."; exit 3; }

now=$(($(date +%s) * 1000))
entry=$(jq -c --arg c "$code" --argjson now "$now" '.pending[$c] // empty | select(.expiresAt > $now)' "$f")
[ -n "$entry" ] || { echo "Code not found or expired: send the bot a new message to get a fresh code."; exit 3; }
sender=$(jq -r .senderId <<<"$entry")
chat=$(jq -r .chatId <<<"$entry")

jq --arg c "$code" --arg s "$sender" \
  '.allowFrom = ((.allowFrom // []) + [$s] | unique) | del(.pending[$c]) | .dmPolicy = "allowlist"' \
  "$f" > "$f.tmp" && chmod 600 "$f.tmp" && mv "$f.tmp" "$f"
# The channel server watches approved/ and tells the user "you're in".
mkdir -p "$dir/approved"
printf '%s' "$chat" > "$dir/approved/$sender"
echo "Paired Telegram user $sender; only allowlisted users can message the bot now."
