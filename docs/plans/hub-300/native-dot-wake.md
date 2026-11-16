# Native Dot wake setup

Native MCP Events is Joshua's selected default for HUB-300. The private plugin
is version 0.1.2; its skill preserves that choice, reuses a matching subscription,
handles mailbox recovery and deduplication, and separates receipt from work.
ChatGPT OAuth and tool/event discovery passed on 2026-11-15. This is a configured
instruction default, not a completed live subscription. The relay and OAuth run
on Cloudflare; Basestar is optional for later task execution.

## Credentials

The Desktop GPT client ID and secret are Cloudflare Access **service-token**
credentials. They already authenticated the tested local OpenAI mailbox client.
They are not OAuth client credentials and must not be pasted into ChatGPT's
OAuth client ID/secret fields.

Cloudflare Access Managed OAuth handles the separate ChatGPT user login.
Dynamic client registration (DCR) creates its OAuth client registration. There
is no manually generated API key to obtain for this path.

## ChatGPT connection

The authenticated [CommLink app](https://chatgpt.com/plugins/plugin_asdk_app_6afa22b05dc88191a45a30e16dfde7ec)
is connected. Its app ID is `asdk_app_6afa22b05dc88191a45a30e16dfde7ec`.
CommLink Prototype references that verified app through `.app.json`, preserving
its existing private identity, MCP configuration and native-wake skill.
Use this existing connection; do not create duplicate entries.

The successful setup used a fresh Chrome tab at ChatGPT → Plugins → Add → Add
custom MCP server. The older tab's unresponsive Add menu was a UI blocker, not
an account restriction. These settings are retained for recovery:

Use these settings in that connection form:

| Field | Value |
| --- | --- |
| Name | CommLink |
| Description | Private HUB-300 agent mailbox and native message events |
| Connection | Public HTTPS / Streamable HTTP |
| MCP server URL | https://commlink-prototype.joshua-m-hublar.workers.dev/mcp |
| Authentication | OAuth |
| Client registration | Dynamic Client Registration (DCR) |
| OAuth client ID / secret | Leave unset when using DCR; do not substitute the service-token files |

The setup form supplied the exact redirect
`https://chatgpt.com/connector/oauth/zdznSZvJxJYf`. This URI is nonsecret and is
different from the later event-delivery URL. Do not substitute the generic stable
callback: Access metadata matches the issuer but does not advertise RFC 9207
authorization-response issuer support. A replacement connection must use its own
observed redirect rather than assuming this connector-specific value applies.

## Access configuration and login

The existing Access application is `84582df9-1583-4e5c-b0ec-770708c448d3`.
DCR is enabled with only the exact redirect above allowed. Localhost and loopback
wildcards remain disabled. API readback confirmed unchanged hostname/Worker
destinations, audience, IdP, all three owner/service policies, 15-minute access
tokens and 336-hour grants. The registration endpoint is now advertised:
`https://cogignition.cloudflareaccess.com/cdn-cgi/access/oauth/registration`.

After Joshua approved the connection, ChatGPT registered its client, Cloudflare
showed the existing allowed owner signed in, and consent returned to ChatGPT.
The connected app displays `send`, `poll`, `ack`, `link_status`, and the event
`commlink.message.created`. No service-token file was used as an OAuth credential.
The owning Dot has now confirmed authenticated `link_status.self = openai`
through this app. A successful status check is not a wake test.

The operator can make the Access settings change through the already-connected
Cloudflare tool. Joshua need not create another API key. The future GitHub
configuration workflow's missing `CLOUDFLARE_API_TOKEN` is separate.

## Subscribe in the owning Dot

The owning Dot must establish its own subscription after connection and callback
transport validation. A local Codex client cannot manufacture a Dot callback.

Suggested instruction to the existing Dot:

> Keep this Dot subscribed to CommLink's commlink.message.created event for
> recipient openai. On an event, use the check-commlink skill to read the mailbox
> and referenced Linear issue, acknowledge receipt, and act within my existing
> authorization. Preserve correlation IDs and avoid acknowledgment reply loops.

ChatGPT supplies the event callback and signing secret. Validate the callback
origin and connection-time destination IP, retain TLS verification for the
original host, reject redirects, and complete the signed challenge before enabling
application delivery. The prototype currently has an empty callback allowlist.
Its exact-origin check is implemented, but connection-time IP validation/pinning
is not wired into the live Worker. The Basestar gateway and Worker integration are prepared in source with
19 gateway/transport and 40 Worker tests passing, plus a host-level pinned TLS
probe. See the [Basestar deployment proposal](basestar.md) for exact approval gates. Do not enable arbitrary callbacks to
get past this.

Test using a fresh Robut-originated nonce, with no manual prompt/poll triggering
the Dot. Record event receipt, the existing Dot's response, correlated mailbox
reply and Robut acknowledgment independently. A callback 2xx alone is not proof.

## Remaining acceptance gates, 2026-11-15

- The owning Dot now has the connected tools and native `subscribe_to_events`.
  Its first `link_status({})` failed because the server rejected MCP request
  `_meta`, which hosts can attach outside the tool's arguments. Commit `80493e3`
  accepts object-valued request metadata without trusting it as identity or
  arguments. A metadata-bearing live probe failed with `-32602` before deployment
  and returned `self: openai`, pending 0 and Grok ready afterward. All 35 tests
  pass, including tool argument strictness and metadata-bearing event requests.
  The owning Dot confirmed its own OAuth status now succeeds: `self: openai`,
  pending 0, no subscriptions and Grok ready.
- Connection-time callback destination validation is implemented/tested in the
  Basestar gateway with Worker integration in source; neither is deployed. The live
  callback-origin allowlist remains empty; no exception is active.
- The owning Dot made one native setup attempt. The host returned a generic task
  service error with no callback origin, and subsequent host/task and mailbox
  checks found no saved task or subscription. One later diagnostic retry confirmed
  `callback_origin_not_approved` with origin `https://connectors.api.openai.com`.
  Worker telemetry queries for the attempt window returned zero matching events.
  Invocation logs were disabled, application sampling was 10%, and handled
  protocol rejections were not logged; absence of telemetry does not establish
  whether the request reached the Worker.
- Runtime `92edc3b` adds `link_status.last_subscription_attempt`: at most the last
  authenticated attempt for that exact principal, with timestamp, outcome, error
  code, categorized reason and approved-format origin only. It excludes full URLs,
  paths, queries, signing secrets, bodies and metadata. Records older than one day
  are hidden and removed during alarm cleanup. A runtime restart preserves them;
  another OAuth/service identity mapped to the same peer cannot read them.
  This instrumentation cannot reconstruct the earlier failed attempt. For a future
  authorized attempt, inspect status using the same owning-Dot OAuth connection.
  A null record means no retained authorized attempt since instrumentation, not
  proof that no request reached Cloudflare or failed before mailbox dispatch.
- A native subscription setup attempt will fail closed with
  `data.reason: callback_origin_not_approved` and `data.callback_origin` containing
  only the HTTPS origin. It sends no callback request and stores no subscription.
  The actual origin is now known and verified by DNS/TLS. Never copy the callback
  capability path, query or signing secret into the issue. Basestar is selected. Action-time access/network/deployment approval and a
  deployed signed-challenge test remain.
- Workers global fetch cannot connect directly to an IP; `cf.resolveOverride`
  is constrained to the operator's zone. Raw TCP sockets can pin a validated IP
  and preserve the TLS name, but Cloudflare IP ranges are blocked. Do not assume
  the actual ChatGPT callback is compatible with that route before resolving its
  observed hostname. The public-only-fetch flag strengthens routing but has not
  been treated as proof of the explicit connection-time validation contract.
- The owning Dot's subscription, unprompted fresh-nonce response, and subsequent
  cloud-task launch remain unverified. No Mac watcher, SMS route or polling task
  was installed.

## Sources

- [OpenAI connection steps](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI OAuth contract and exact redirect](https://developers.openai.com/plugins/build/auth)
- [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [OpenAI MCP Events lifecycle and callback validation](https://developers.openai.com/plugins/build/mcp-events)
- [MCP request metadata schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.ts)
- [Workers direct-IP fetch limitation](https://developers.cloudflare.com/workers/platform/known-issues/#fetch-to-ip-addresses)
- [Workers TCP socket restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#considerations)
