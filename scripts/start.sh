#!/bin/bash
# Start vault sync and the agent in tmux (no-op for sessions that already run).
# FRESH=1 starts a new conversation instead of --continue.

# Agent workdir: WORKDIR, else the first repo from REPOS, else ~.
first=${REPOS%%,*}
first=${first//[[:space:]]/}
first=${first%%#*}
dir=${WORKDIR:-}
[ -n "$dir" ] || [ -z "$first" ] || dir=$HOME/projects/$(basename "$first" .git)
[ -d "$dir" ] || dir=$HOME

args="--permission-mode auto --rc"
[ -z "${TELEGRAM_BOT_TOKEN:-}" ] || args="$args --channels plugin:telegram@claude-plugins-official"
if [ "${FRESH:-}" = "1" ]; then
  cmd="claude $args"
else
  # --continue fails when there is no previous conversation yet (first start).
  cmd="claude --continue $args || claude $args"
fi

[ ! -d ~/vault/.git ] || tmux has-session -t sync 2>/dev/null || tmux new -d -s sync vault-sync.sh
[ -z "${TELEGRAM_BOT_TOKEN:-}" ] || tmux has-session -t typing 2>/dev/null || tmux new -d -s typing 'typing.sh loop'
# A new session starts idle: a turn killed mid-way (fresh.sh, crash, reboot) never ran its Stop hook,
# and a startup dialog (folder trust, login) runs no hooks, so Telegram would show "typing…" for 30 min.
tmux has-session -t claude 2>/dev/null || { typing.sh stop; tmux new -d -s claude -c "$dir" "$cmd"; }
tmux ls
