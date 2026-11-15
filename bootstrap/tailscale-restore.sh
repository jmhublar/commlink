#!/bin/bash
# Idempotent Tailscale + Comlink relay restore for Robut's box (survives rebuilds; state in /home/box).
# 2026-10-17: tailscaled writes its state as root:root 0600, which the box "Update"/rebuild file copy
# (runs as user box) cannot read, so the node identity was lost and a NEW node (robut-1) was registered.
# Fix: the watchdog mirrors the state to a box-owned copy (STATE_MIRROR); this script restores from it
# before starting tailscaled, so the same node identity comes back after a rebuild.
set -u
# Source of truth: github.com/jmhublar/commlink, checked out at $REPO. No secrets live in the repo:
# TAILSCALE_AUTHKEY_COMLINK comes from the environment; relay tokens/DB live in ~/.hub-relay (0700).
REPO=${COMMLINK_REPO:-/home/box/commlink}
TSDIR=/home/box/.tailscale; STATE=$TSDIR/tailscaled.state; STATE_MIRROR=$TSDIR/tailscaled.state.mirror
SOCK=/var/run/tailscale/tailscaled.sock
LOG=$TSDIR/restore.log; mkdir -p "$TSDIR"; chmod 700 "$TSDIR"
log(){ echo "$(date '+%F %T %Z') $*" | tee -a "$LOG"; }
# 0. timezone (system setting lives outside /home/box, so it is lost on rebuild)
if [ "$(readlink /etc/localtime)" != /usr/share/zoneinfo/America/Indiana/Indianapolis ]; then
  sudo -n ln -sf /usr/share/zoneinfo/America/Indiana/Indianapolis /etc/localtime && echo America/Indiana/Indianapolis | sudo -n tee /etc/timezone >/dev/null && log "set timezone America/Indiana/Indianapolis"
fi
# 1. package (/usr/sbin is not on box's PATH, so check the path directly)
if [ ! -x /usr/sbin/tailscaled ]; then
  log "installing tailscale"
  sudo -n mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | sudo -n tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
  curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | sudo -n tee /etc/apt/sources.list.d/tailscale.list >/dev/null
  sudo -n apt-get update -qq >>"$LOG" 2>&1; sudo -n DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tailscale >>"$LOG" 2>&1
  # 2026-11-15: Debian mirror 500s left iptables uninstallable, so apt never installed tailscale. Fall back to static binaries.
  if [ ! -x /usr/sbin/tailscaled ]; then
    V=$(curl -fsSL 'https://pkgs.tailscale.com/stable/?mode=json' | python3 -c 'import sys,json;print(json.load(sys.stdin)["TarballsVersion"])' 2>/dev/null); V=${V:-1.104.7}
    T=$(mktemp -d); if curl -fsSL -o "$T/ts.tgz" "https://pkgs.tailscale.com/stable/tailscale_${V}_amd64.tgz" && tar xzf "$T/ts.tgz" -C "$T"; then
      sudo -n install -m 755 "$T"/tailscale_${V}_amd64/tailscaled /usr/sbin/tailscaled && sudo -n install -m 755 "$T"/tailscale_${V}_amd64/tailscale /usr/bin/tailscale && log "installed tailscale $V static binaries (apt failed)"
    else log "ERROR: static tailscale download failed"; fi; rm -rf "$T"
  fi
fi
# 2. watchdog (only rewritten when content changes, so a running watchdog is not disturbed)
WDTMP=$(mktemp)
cat >"$WDTMP" <<'WD'
#!/bin/bash
# Threshold 4 checks (~2 min). Tested 10 min: tailscaled does NOT self-recover after box pause; restart is needed.
# Also mirrors tailscaled.state (root 0600) to a box-owned copy so a box rebuild keeps the node identity.
STATE=/home/box/.tailscale/tailscaled.state; MIRROR=/home/box/.tailscale/tailscaled.state.mirror
SOCK=/var/run/tailscale/tailscaled.sock; LOG=/home/box/.tailscale/watchdog.log
THRESH=${TS_WD_THRESH:-4}
start(){ mkdir -p /var/run/tailscale; nohup tailscaled --state="$STATE" --socket="$SOCK" >>/home/box/.tailscale/tailscaled.log 2>&1 & echo "$(date '+%F %T %Z') started tailscaled pid=$!" >>"$LOG"; }
mirror(){ [ -s "$STATE" ] || return; if [ ! -s "$MIRROR" ] || ! cmp -s "$STATE" "$MIRROR"; then
  install -m 600 -o box -g box "$STATE" "$MIRROR.tmp" && mv -f "$MIRROR.tmp" "$MIRROR" && echo "$(date '+%F %T %Z') mirrored tailscaled.state" >>"$LOG"; fi; }
off=0; echo "$(date '+%F %T %Z') watchdog start pid=$$ thresh=$THRESH" >>"$LOG"
while true; do
  if ! pgrep -x tailscaled >/dev/null; then echo "$(date '+%F %T %Z') tailscaled not running; starting" >>"$LOG"; start; off=0; sleep 10; continue; fi
  on=$(tailscale status --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("Self",{}).get("Online"))' 2>/dev/null)
  if [ "$on" = "True" ]; then [ $off -gt 0 ] && echo "$(date '+%F %T %Z') recovered on its own after $off checks offline" >>"$LOG"; off=0; mirror; else off=$((off+1)); [ $off -eq 1 ] && echo "$(date '+%F %T %Z') Self.Online=$on; watching" >>"$LOG"; fi
  if [ $off -ge $THRESH ]; then echo "$(date '+%F %T %Z') Self.Online=$on for ~$((off/2))min; restarting tailscaled pid=$(pgrep -x tailscaled|tr '\n' ' ')" >>"$LOG"; pkill -x tailscaled; sleep 3; start; off=0; fi
  sleep 30
done
WD
if ! sudo -n cmp -s "$WDTMP" /usr/local/sbin/tailscale-watchdog; then
  sudo -n install -m 755 "$WDTMP" /usr/local/sbin/tailscale-watchdog && log "installed watchdog"
  pkill -f /usr/local/sbin/tailscale-watchdog 2>/dev/null; sudo -n pkill -f /usr/local/sbin/tailscale-watchdog 2>/dev/null
fi
rm -f "$WDTMP"
HOOK='pgrep -f /usr/local/sbin/tailscale-watchdog >/dev/null 2>&1 || sudo -n nohup /usr/local/sbin/tailscale-watchdog >/dev/null 2>&1 &'
echo "$HOOK" | sudo -n tee /etc/profile.d/tailscale-watchdog.sh >/dev/null
grep -q tailscale-watchdog /etc/bash.bashrc || echo "$HOOK" | sudo -n tee -a /etc/bash.bashrc >/dev/null
# 3. restore node identity from the box-owned mirror if the root-owned state did not survive
if ! sudo -n test -s "$STATE" && [ -s "$STATE_MIRROR" ]; then
  if pgrep -x tailscaled >/dev/null; then sudo -n pkill -x tailscaled; sleep 3; fi
  sudo -n install -m 600 -o root -g root "$STATE_MIRROR" "$STATE" && log "restored tailscaled.state from mirror"
fi
# 4. tailscaled + watchdog
pgrep -x tailscaled >/dev/null || { sudo -n mkdir -p /var/run/tailscale; sudo -n nohup tailscaled --state="$STATE" --socket="$SOCK" >>"$TSDIR/tailscaled.log" 2>&1 & sleep 5; }
pgrep -f /usr/local/sbin/tailscale-watchdog >/dev/null || sudo -n nohup /usr/local/sbin/tailscale-watchdog >/dev/null 2>&1 &
# 5. login only if needed (a new login registers a NEW node; log loudly when a mirror existed)
BS=$(sudo -n tailscale status --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("BackendState"))' 2>/dev/null)
for i in 1 2 3 4 5 6; do [ "$BS" = Running ] || [ "$BS" = NeedsLogin ] && break; sleep 5
  BS=$(sudo -n tailscale status --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("BackendState"))' 2>/dev/null); done
if [ "$BS" != "Running" ]; then
  [ -s "$STATE_MIRROR" ] && log "WARNING: state=$BS even with a mirrored identity; 'tailscale up' will register a NEW node"
  if [ -n "${TAILSCALE_AUTHKEY_COMLINK:-}" ]; then log "running tailscale up (state=$BS)"
    sudo -n tailscale up --auth-key="$TAILSCALE_AUTHKEY_COMLINK" --hostname=grok --advertise-tags=tag:commlink >>"$LOG" 2>&1
  else log "not logged in and TAILSCALE_AUTHKEY_COMLINK empty"; fi
fi
sudo -n tailscale set --operator=box >/dev/null 2>&1
# 5b. 2026-11-15: node name is "grok" (Joshua); the service address svc-commlink is what clients use.
# 6. Comlink relay supervisor (tailnet-ip mode), run from the repo checkout. Pull first if a read-only deploy key is set up.
if [ -d "$REPO/.git" ] && [ -f /home/box/.ssh/commlink_deploy ]; then
  git -C "$REPO" pull --ff-only -q >>"$LOG" 2>&1 && log "pulled $(git -C "$REPO" rev-parse --short HEAD)" || log "WARNING: git pull failed; running current checkout"
fi
chmod 700 /home/box/.hub-relay /home/box/.hub-relay/tokens 2>/dev/null
if [ -x "$REPO/relay/supervisor.sh" ] && ! pgrep -f commlink/relay/supervisor.sh >/dev/null; then
  for i in $(seq 1 12); do tailscale ip -4 >/dev/null 2>&1 && break; sleep 5; done
  HUB_RELAY_MODE=tailnet-ip setsid -f "$REPO/relay/supervisor.sh" >/dev/null 2>&1 </dev/null
  log "started relay supervisor from $REPO"
elif [ ! -d "$REPO" ]; then log "WARNING: $REPO missing; clone github.com/jmhublar/commlink there"; fi
# 7. svc:svc-commlink (stable client address https://svc-commlink.tailbde0eb.ts.net), proxied to the relay on this node's tailnet IP.
#    A NEW node needs admin approval as the service host unless an autoApprover covers tag:commlink.
TIP=$(tailscale ip -4 2>/dev/null | head -1)
if [ -n "$TIP" ] && ! timeout 10 sudo -n tailscale serve status 2>/dev/null | grep -q "http://$TIP:8780"; then
  timeout 25 sudo -n tailscale serve --bg --service=svc:svc-commlink --https=443 "http://$TIP:8780" >>"$LOG" 2>&1 && log "applied svc:svc-commlink -> $TIP:8780"
fi
log "restore done"
