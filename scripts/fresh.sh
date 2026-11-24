#!/bin/bash
# Restart the agent with a clean context, or keep the conversation with --continue.
# Returns at once; the restart runs detached after 3 s so the current reply can finish.
# Progress: ~/.canopy/fresh.log. When done, Telegram allowlisted chats are notified.
if [ "$1" != "--bg" ]; then
  mkdir -p ~/.canopy
  setsid "$0" --bg "$1" >>~/.canopy/fresh.log 2>&1 &
  exit 0
fi

if [ "$2" = "--continue" ]; then fresh=0; done_msg="✅ Agent restarted, conversation kept"
else fresh=1; done_msg="✅ New session is ready"; fi

sleep 3
echo "$(date) kill"
tmux kill-session -t claude
# start.sh is a no-op while the old session still exists, so wait until it is really gone.
while tmux has-session -t claude 2>/dev/null; do sleep 1; done
echo "$(date) start (FRESH=$fresh)"
FRESH=$fresh start.sh
sleep 20
if tmux has-session -t claude 2>/dev/null; then msg=$done_msg; else msg="❌ The agent failed to start"; fi
echo "$(date) $msg"
notify.sh "$msg"
