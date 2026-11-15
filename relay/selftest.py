#!/usr/bin/env python3
"""Self-test: WAKE->ACK->ACK2 round trip through the relay, both roles. Tokens read from files, never printed."""
import json, os, sys, time, uuid, urllib.request, urllib.error
URL = sys.argv[1] if len(sys.argv) > 1 else "http://%s:8780/mcp" % __import__("subprocess").run(["tailscale", "ip", "-4"], capture_output=True, text=True).stdout.split()[0]
H = os.path.expanduser("~/.hub-relay")
tok = {p: open(f"{H}/tokens/{p}").read().strip() for p in ("robut", "openai")}
def call(who, method, params=None, raw_token=None, id_=1):
    body = {"jsonrpc": "2.0", "id": id_, "method": method}
    if params is not None: body["params"] = params
    hdr = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    t = raw_token if raw_token is not None else tok[who]
    if t: hdr["Authorization"] = "Bearer " + t
    r = urllib.request.Request(URL, json.dumps(body).encode(), hdr)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp: return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e: return e.code, None
def tool(who, name, args):
    s, r = call(who, "tools/call", {"name": name, "arguments": args}); return r["result"]["structuredContent"] if "structuredContent" in r["result"] else r["result"]
def env(frm, to, typ, seq, corr=None, payload=None, ttl=600):
    m = str(uuid.uuid4())
    return {"protocol_version": "1.0", "message_id": m, "correlation_id": corr or m, "from": frm, "to": to, "type": typ, "seq": seq,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ttl": ttl, "payload": payload or {}}
ok = True
def check(label, cond, detail=""):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + label, detail)
s, _ = call("robut", "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "selftest", "version": "0"}})
check("initialize", s == 200)
check("401 without token", call(None, "tools/list", raw_token="")[0] == 401)
check("401 bad token", call(None, "tools/list", raw_token="wrong")[0] == 401)
check("tools/list", [t["name"] for t in call("openai", "tools/list")[1]["result"]["tools"]] == ["send", "poll", "ack", "link_status"])
cur = {p: tool(p, "poll", {"since": 0, "limit": 50})["next_since"] for p in ("robut", "openai")}
for p in cur:  # drain old
    for m in tool(p, "poll", {"since": 0, "limit": 50})["messages"]: tool(p, "ack", {"id": m["envelope"]["message_id"]})
db_file = f"{H}/doorbell.robut"; before = os.path.getmtime(db_file) if os.path.exists(db_file) else 0
# 1 robut WAKE
w = env("robut", "openai", "WAKE", 1, payload={"intent": "HUB-300 selftest", "capabilities": ["doorbell", "msg.text"]}, ttl=1800)
r = tool("robut", "send", {"to": "openai", "msg": w}); check("WAKE accepted", r["status"] == "accepted", r)
check("WAKE resend = duplicate", tool("robut", "send", {"to": "openai", "msg": w})["status"] == "duplicate")
bad = env("openai", "robut", "MSG", 1, payload={"content_type": "text/plain", "body": "x"})
check("spoofed from rejected auth_mismatch", tool("robut", "send", {"to": "robut", "msg": bad}).get("error", {}).get("code") == "auth_mismatch")
# 2 openai polls (poll fallback path: openai has no/failed doorbell), acks, sends ACK
p = tool("openai", "poll", {"since": cur["openai"]}); got = [m["envelope"] for m in p["messages"]]
check("openai polled WAKE", any(e["message_id"] == w["message_id"] for e in got))
check("openai ack WAKE", tool("openai", "ack", {"id": w["message_id"]})["status"] == "acked")
check("ack idempotent", tool("openai", "ack", {"id": w["message_id"]})["status"] == "already_acked")
check("robut can't ack openai's msg", tool("robut", "ack", {"id": w["message_id"]})["status"] == "unknown")
a = env("openai", "robut", "ACK", 1, corr=w["correlation_id"], payload={"ack_of": w["message_id"], "capabilities": ["msg.text"]})
r = tool("openai", "send", {"to": "robut", "msg": a}); check("ACK accepted + doorbell", r["status"] == "accepted" and r["doorbell"] in ("rung", "coalesced"), r)
time.sleep(3)
check("robut doorbell rang (listener tcp:8443)", os.path.exists(db_file) and os.path.getmtime(db_file) > before)
# 3 robut polls, acks, ACK2
p = tool("robut", "poll", {"since": cur["robut"]}); e = [m["envelope"] for m in p["messages"] if m["envelope"]["message_id"] == a["message_id"]]
check("robut polled ACK", e and e[0]["payload"]["ack_of"] == w["message_id"])
tool("robut", "ack", {"id": a["message_id"]})
a2 = env("robut", "openai", "ACK2", 2, corr=w["correlation_id"], payload={"ack_of": a["message_id"]}, ttl=1800)
check("ACK2 accepted", tool("robut", "send", {"to": "openai", "msg": a2})["status"] == "accepted")
p = tool("openai", "poll", {"since": cur["openai"]}); e = [m["envelope"] for m in p["messages"] if m["envelope"]["type"] == "ACK2"]
check("openai got ACK2 -> both ESTABLISHED", e and e[0]["payload"]["ack_of"] == a["message_id"] and e[0]["correlation_id"] == w["correlation_id"])
tool("openai", "ack", {"id": a2["message_id"]})
ls = tool("robut", "link_status", {}); print("link_status(robut):", json.dumps({k: ls[k] for k in ("self", "profile", "peers")}))
print("RESULT:", "ALL PASS" if ok else "FAILURES"); sys.exit(0 if ok else 1)
