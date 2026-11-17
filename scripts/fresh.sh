#!/bin/bash
# Restart the agent with a clean context in 3 s (lets the current reply finish first).
setsid bash -c 'sleep 3; tmux kill-session -t claude; FRESH=1 start.sh' >/dev/null 2>&1 &
