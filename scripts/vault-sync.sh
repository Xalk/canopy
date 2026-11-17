#!/bin/bash
# Every 5 min: commit local vault changes, pull --rebase, push. Conflicts are logged, not resolved.
cd ~/vault || exit 1
while true; do
  git add -A
  git diff --cached --quiet || git commit -qm "server: $(date '+%F %H:%M')"
  git pull --rebase -q || { git rebase --abort 2>/dev/null; echo "pull failed $(date)" >> ~/vault-sync.log; }
  git push -q -u origin HEAD  # -u: works for an empty vault whose remote branch doesn't exist yet
  sleep 300
done
