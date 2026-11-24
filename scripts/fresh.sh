#!/bin/bash
# Restart the agent with a clean context. Returns at once; the restart runs detached after 3 s so the
# current reply can finish. Progress: ~/.canopy/fresh.log. When done, Telegram allowlisted chats are notified.
if [ "$1" != "--bg" ]; then
  mkdir -p ~/.canopy
  setsid "$0" --bg >>~/.canopy/fresh.log 2>&1 &
  exit 0
fi

sleep 3
echo "$(date) kill"
tmux kill-session -t claude
# start.sh is a no-op while the old session still exists, so wait until it is really gone.
while tmux has-session -t claude 2>/dev/null; do sleep 1; done
echo "$(date) start"
FRESH=1 start.sh
sleep 20
if tmux has-session -t claude 2>/dev/null; then msg="✅ New session is ready"; else msg="❌ New session failed to start"; fi
echo "$(date) $msg"

# Notify via the Bot API directly: no agent turn needed.
access=~/.claude/channels/telegram/access.json
[ -n "$TELEGRAM_BOT_TOKEN" ] && [ -f "$access" ] || exit 0
for id in $(jq -r '.allowFrom[]?' "$access"); do
  curl -s -o /dev/null "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$id" --data-urlencode "text=$msg"
done
