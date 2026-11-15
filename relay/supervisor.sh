#!/bin/sh
# HUB-300 relay supervisor: same pattern as /usr/local/sbin/tailscale-watchdog (no cron/systemd).
# Restarts relay + doorbell listener if they die; re-applies `tailscale serve` (HTTPS, tailnet-only) if missing.
# NEVER enables Funnel. Uses no auth keys.
DIR=/workspace/hub-300/relay
export HUB_RELAY_HOME="${HUB_RELAY_HOME:-$HOME/.hub-relay}"
LOG="$HUB_RELAY_HOME/supervisor.log"
mkdir -p "$HUB_RELAY_HOME"
# Single-instance lock (HUB-306): a second launch exits immediately.
LOCK="$HUB_RELAY_HOME/supervisor.lock"
exec 9>"$LOCK" || exit 1
flock -n 9 || exit 0
while true; do
  if ! pgrep -f "python3 $DIR/relay.py" >/dev/null; then
    echo "$(date '+%F %T %Z') relay not running; starting" >>"$LOG"
    if [ "${HUB_RELAY_MODE:-tailnet-ip}" = serve ]; then B=127.0.0.1; else B=$(tailscale ip -4 2>/dev/null | head -1); fi
    [ -n "$B" ] && { echo "$B" >"$HUB_RELAY_HOME/bind_ip"; HUB_RELAY_BIND=$B nohup python3 "$DIR/relay.py" >>"$HUB_RELAY_HOME/relay.log" 2>&1 & }
  fi
  # tailnet-ip mode: if the node's tailnet IP changed (new node / IP edited in admin console), rebind.
  if [ "${HUB_RELAY_MODE:-tailnet-ip}" != serve ] && [ -f "$HUB_RELAY_HOME/bind_ip" ]; then
    NOW=$(tailscale ip -4 2>/dev/null | head -1); WAS=$(cat "$HUB_RELAY_HOME/bind_ip")
    if [ -n "$NOW" ] && [ "$NOW" != "$WAS" ]; then
      echo "$(date '+%F %T %Z') tailnet IP changed $WAS -> $NOW; restarting relay" >>"$LOG"
      pkill -f "python3 $DIR/relay.py"; sleep 2; continue
    fi
  fi
  if ! pgrep -f "python3 $DIR/doorbell_listener.py" >/dev/null; then
    echo "$(date '+%F %T %Z') doorbell listener not running; starting" >>"$LOG"
    nohup python3 "$DIR/doorbell_listener.py" >>"$HUB_RELAY_HOME/doorbell.log" 2>&1 &
  fi
  # Mode "serve" (preferred): relay on 127.0.0.1, HTTPS via tailscale serve. Needs Serve/HTTPS enabled on tailnet.
  # Mode "tailnet-ip" (fallback, spec §2.1 allows): relay binds only the tailnet IP over plain HTTP (WireGuard-encrypted).
  if [ "${HUB_RELAY_MODE:-tailnet-ip}" = serve ] && ! timeout 10 tailscale serve status 2>/dev/null | grep -q "127.0.0.1:8780"; then
    echo "$(date '+%F %T %Z') tailscale serve missing; applying" >>"$LOG"
    timeout 20 tailscale serve --bg --https=443 http://127.0.0.1:8780 >>"$LOG" 2>&1
  fi
  sleep 30
done
