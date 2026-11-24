#!/bin/bash
# Usage-limit alerts over Telegram. Sent by the shell, so they arrive even when the model can't answer.
#   limits.sh status   statusLine command: prints "5h 42% · 7d 13%"; warns once per window at WARN_AT %
#   limits.sh reached  StopFailure hook (matcher rate_limit): the agent is paused until the reset
WARN_AT=80
state=~/.canopy/limits
mkdir -p "$state"
when() { date -d "@$1" '+%a %H:%M'; }
once() { [ ! -e "$state/$1" ] && touch "$state/$1"; }  # true only the first time per key

case "$1" in
status)
  json=$(cat)
  limits=$(echo "$json" | jq -c '.rate_limits // empty')
  [ -z "$limits" ] || echo "$limits" > "$state/last.json"  # keep the last known reset times
  find "$state" -name '*-*' -mtime +8 -delete
  out=""
  for w in five_hour seven_day; do
    read -r pct reset < <(echo "$json" | jq -r --arg w "$w" '.rate_limits[$w] // empty | "\(.used_percentage) \(.resets_at)"')
    [ -n "$pct" ] || continue
    pct=${pct%.*}
    label=${w/five_hour/5h}; label=${label/seven_day/7d}
    out+="${out:+ · }$label $pct%"
    if [ "$pct" -ge "$WARN_AT" ] && once "warn-$w-$reset"; then
      notify.sh "⚠️ Claude $label usage is at $pct%. Resets $(when "$reset")." &
    fi
  done
  echo "$out"
  ;;
reached)
  # The fullest window is the one that ran out; its reset time comes from the last statusline update.
  reset=$(jq -r 'to_entries | max_by(.value.used_percentage) | .value.resets_at // empty' "$state/last.json" 2>/dev/null)
  if once "reached-${reset:-$(date +%F-%H)}"; then
    notify.sh "⛔ Claude usage limit reached: the agent can't reply${reset:+ until $(when "$reset")}. Messages you send now wait for the reset."
  fi
  ;;
esac
