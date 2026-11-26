#!/bin/bash
# Keep Telegram's "typing…" on while the agent works. The plugin sends it once per message and
# Telegram drops it after ~5 s, so this resends it every 4 s until the turn ends.
#   typing.sh start | stop   Claude Code hooks: a turn is running (UserPromptSubmit, PreToolUse)
#                            or has ended / waits for you (Stop, StopFailure, Notification)
#   typing.sh loop           runs in the tmux session "typing", started by start.sh
busy=~/.canopy/busy

case "$1" in
start)
  mkdir -p ~/.canopy
  touch "$busy"
  ;;
stop)
  rm -f "$busy"
  ;;
loop)
  access=~/.claude/channels/telegram/access.json
  while true; do
    # -mmin -30: if a turn never reported its end, stop showing "typing" after 30 min.
    if [ -n "$(find "$busy" -mmin -30 2>/dev/null)" ] && [ -f "$access" ]; then
      for id in $(jq -r '.allowFrom[]?' "$access"); do
        curl -s -o /dev/null --max-time 5 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendChatAction" \
          --data-urlencode "chat_id=$id" --data-urlencode "action=typing"
      done
    fi
    sleep 4
  done
  ;;
esac
