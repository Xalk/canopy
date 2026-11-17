#!/bin/bash
# Every 5 min: commit local vault changes, pull --rebase, push. Conflicts are logged, not resolved.
cd ~/vault || exit 1
while true; do
  git add -A
  git diff --cached --quiet || git commit -qm "server: $(date '+%F %H:%M')"
  git pull --rebase -q || { git rebase --abort; echo "conflict $(date)" >> ~/vault-sync.log; }
  git push -q
  sleep 300
done
