#!/usr/bin/env bash
input=$(cat)

cwd=$(echo "$input"        | jq -r '.workspace.current_dir // .cwd')
model=$(echo "$input"      | jq -r '.model.display_name')
ctx_pct=$(echo "$input"    | jq -r '.context_window.used_percentage // empty')
effort=$(echo "$input"     | jq -r '.effort.level // empty')
fivehr_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
sevend_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
session_id=$(echo "$input" | jq -r '.session_id // empty')
sess_cost=$(echo "$input"  | jq -r '.cost.total_cost_usd // empty')

folder=$(basename "$cwd")
branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)

dir_part="$folder"
[ -n "$branch" ] && dir_part="$dir_part  $branch"

sep="\033[90m|\033[0m"

# Model + effort (e.g. "Opus 4.7 High")
model_part="$model"
if [ -n "$effort" ]; then
  effort_cap="$(echo "${effort:0:1}" | tr '[:lower:]' '[:upper:]')${effort:1}"
  model_part="$model $effort_cap"
fi

# Bar renderer: percentage, width, color code
render_bar() {
  local pct=$1 width=$2 color=$3
  local filled empty bar=""
  filled=$(awk -v p="$pct" -v w="$width" 'BEGIN{printf "%.0f", p*w/100}')
  [ "$filled" -gt "$width" ] && filled=$width
  empty=$((width - filled))
  bar+="\033[${color}m"
  for ((i=0; i<filled; i++)); do bar+="█"; done
  bar+="\033[90m"
  for ((i=0; i<empty; i++)); do bar+="░"; done
  bar+="\033[0m"
  printf "%b" "$bar"
}

# Pick bar color from percentage (green <60, yellow 60–85, red >85)
bar_color_for() {
  local p=$1
  if   [ "$p" -lt 60 ]; then echo 32
  elif [ "$p" -lt 85 ]; then echo 33
  else                       echo 31
  fi
}

# Render "label bar pct%" segment from a percentage
render_pct_segment() {
  local label=$1 pct_raw=$2
  [ -z "$pct_raw" ] && return
  local pct
  pct=$(echo "$pct_raw" | awk '{printf "%.0f", $1}')
  local color
  color=$(bar_color_for "$pct")
  local bar
  bar=$(render_bar "$pct" 10 "$color")
  printf "%b %s%%" "${label}${bar}" "$pct"
}

ctx_part=$(render_pct_segment "ctx " "$ctx_pct")
fh_part=$(render_pct_segment  "\$5h " "$fivehr_pct")
sd_part=$(render_pct_segment  "\$7d " "$sevend_pct")

# Month-to-date personal spend, accumulated across this machine's sessions.
# Lock-free: each session writes only its own file (keyed by session_id) under a
# month-stamped dir, so concurrent sessions never race. total_cost_usd is
# cumulative-per-session, so overwriting with the latest value is correct.
month=$(date +%Y-%m)
spend_dir="$HOME/.claude/spend/$month"
mtd=""
if [ -n "$session_id" ] && [ -n "$sess_cost" ]; then
  mkdir -p "$spend_dir"
  printf '%s\n' "$sess_cost" > "$spend_dir/$session_id"
fi
# shortcut: old month dirs left on disk; prune with find+rm if it ever matters (a few KB/month).
[ -d "$spend_dir" ] && mtd=$(cat "$spend_dir"/* 2>/dev/null | awk '{s+=$1} END{printf "%.2f", s}')

# Adaptive tier: track against 100, then 300, then 500 as spend crosses each.
spend_part=""
if [ -n "$mtd" ]; then
  if   awk "BEGIN{exit !($mtd > 300)}"; then tier=500
  elif awk "BEGIN{exit !($mtd > 100)}"; then tier=300
  else tier=100
  fi
  spend_pct=$(awk -v m="$mtd" -v t="$tier" 'BEGIN{printf "%.0f", m/t*100}')
  spend_bar=$(render_bar "$spend_pct" 10 "$(bar_color_for "$spend_pct")")
  spend_part=$(printf "\$%s%b /%s" "$mtd" "$spend_bar" "$tier")
fi

sess_part=""
if [ -n "$sess_cost" ]; then
  sess_part=$(printf "sess \$%.2f" "$sess_cost")
fi

out="\033[1;34m${dir_part}\033[0m ${sep} \033[0;33m${model_part}\033[0m"
[ -n "$ctx_part" ]   && out+=" ${sep} ${ctx_part}"
[ -n "$fh_part" ]    && out+=" ${sep} ${fh_part}"
[ -n "$sd_part" ]    && out+=" ${sep} ${sd_part}"
[ -n "$sess_part" ]  && out+=" ${sep} ${sess_part}"
[ -n "$spend_part" ] && out+=" ${sep} ${spend_part}"

printf "%b" "$out"
