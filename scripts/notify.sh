#!/bin/bash
# notify.sh "<text>" - send a message to every allowlisted Telegram chat via the Bot API.
# Runs in the shell, not the model: works even when the agent can't reply (usage limit, restart).
access=~/.claude/channels/telegram/access.json
[ -n "$TELEGRAM_BOT_TOKEN" ] && [ -f "$access" ] || exit 0
for id in $(jq -r '.allowFrom[]?' "$access"); do
  curl -s -o /dev/null --max-time 10 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$id" --data-urlencode "text=$1"
done
