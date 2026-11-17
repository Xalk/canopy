#!/bin/bash
# Start vault sync and the agent in tmux (no-op for sessions that already run).
# FRESH=1 starts a new conversation instead of --continue.

# Agent workdir: WORKDIR, else the first repo from REPOS, else ~.
first=${REPOS%%,*}
first=${first//[[:space:]]/}
dir=${WORKDIR:-}
[ -n "$dir" ] || [ -z "$first" ] || dir=$HOME/projects/$(basename "$first" .git)
[ -d "$dir" ] || dir=$HOME

args="--permission-mode auto --rc --channels plugin:telegram@claude-plugins-official"
if [ "${FRESH:-}" = "1" ]; then
  cmd="claude $args"
else
  # --continue fails when there is no previous conversation yet (first start).
  cmd="claude --continue $args || claude $args"
fi

[ ! -d ~/vault/.git ] || tmux has-session -t sync 2>/dev/null || tmux new -d -s sync vault-sync.sh
tmux has-session -t claude 2>/dev/null || tmux new -d -s claude -c "$dir" "$cmd"
tmux ls
