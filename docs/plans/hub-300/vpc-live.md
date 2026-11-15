# HUB-300 private VPC deployment — 2026-11-15

The private route is live. This supersedes the exploration-only state in vpc.md
and public Access proposal in basestar.md; the trust boundaries in vpc.md still apply.

- Worker runtime7ca277b, version8b283d8f-c5e7-47f2-95bb-e1653dd01b1e at100%,
  deployment77a313aa-7b8c-4282-8fea-438cfe3f515b. Configuration changes created a
  new version after the health-code upload; all unrelated bindings were inherited.
- VPC Service01a1e172-f93b-7473-9f9f-3fc83a50d2ed fixes only the gateway hostname8080
  through Kenning, with HTTPS disabled. Worker binding CALLBACK_GATEWAY, modevpc.
- Gateway image from reviewed a05d7bd:
  sha256:814667b71b35bb950888e722db9d45d5edbc433f11aa0d2eebef07a11104829c.
  Chart0.2.0 OCI digest:
  sha256:e733b94c89a866708016f594a69006da05607756810ab1b5b916cce232ce2f8a.
- SysOp branch codex/hub-300-callback captures actual Helm source/release, namespace,
  root adoption entry, status/apply/check targets and bounded test harness. Bootstrap
  applied only its commlink subtree; Helm controller owns release lifecycle. Main
  GitOps adoption awaits review/merge; no merge or unrelated root apply performed.
- Chart source uses registry internal port5000, not host port5111. Existing
  containerd image alias5111 works. Initial chart-source failure was corrected.

## Verified

HelmRelease and gatewayReady1/1, no restarts. UID1000, PID1 namecommlink-HUB300,
executable/usr/local/bin/commlink-HUB300; redacted startup event only. Persistent
service is owned by Joshua for HUB-300, purpose narrow callback egress, supervised
by K3s/Flux Helm. Lifecycle/status/log/stop/recovery commands are in basestar.md.

Bounded synthetic Jobs proved cloudflared namespace+app-label health200 and
rejection400 for a private callback target. A cloudflared-labeled Pod in default
namespace and an untrusted Pod in commlink namespace were blocked. K3s reports
ECONNREFUSED for denied paths; a short policy-propagation delay was needed before
checking. All Jobs were removed;35-second active deadlines/TTL provide backup.

A probe from the gateway Pod selected104.18.38.184, verified original OpenAI
hostname and system trust, negotiatedTLS1.3, sent no HTTP. Authenticated real
CommLink link_status subsequently returned callback_transport modevpc reachabletrue,
proving the actual Worker→VPC→tunnel→gateway HTTP health route, not just local tests.
Worker45 tests/typecheck/build pass; gateway22 targeted tests and chart/image checks
passed. Health check is bounded to2seconds/1KiB and sends no callback or mailbox data.

## Callback gate

Joshua separately approved only https://connectors.api.openai.com and the owning
Dot subscription after deployment tests. Automatic review initially blocked the
allowlist change as a separate approval step; after explicit confirmation it
succeeded. Readback preserves VPC/identity/Grok bindings and exact-only allowlist.
No callback path/query or signing secret was recorded.

At this record's capture, native subscriptions are empty and there is no fresh
signed challenge or unprompted Dot reply. The existing last_subscription_attempt
origin rejection predates enablement. It is historical, not a new test result.

The owning Dot must invoke native subscribe_to_events in its own thread, recipient
openai, run_in_current_thread=true. This implementation child must not subscribe
itself. Prove challenge, actual task creation, event acceptance, unprompted execution
and correlated Robut reply separately. A callback2xx alone is not completion.

No new application credential, Access app, public gateway hostname, paid upgrade,
account role or shared tunnel restart was needed. Basestar uptime remains required.
