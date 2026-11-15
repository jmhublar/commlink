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
Authenticated `link_status.self = openai` through this new app still needs a host
tool invocation; successful metadata discovery is not a mailbox or wake test.

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
is not yet implemented/proved. Do not enable arbitrary callbacks to get past this.

Test using a fresh Robut-originated nonce, with no manual prompt/poll triggering
the Dot. Record event receipt, the existing Dot's response, correlated mailbox
reply and Robut acknowledgment independently. A callback 2xx alone is not proof.

## Remaining acceptance gates, 2026-11-15

- The connected app's tools/events are visible in ChatGPT, but no CommLink tool or
  native subscription capability is exposed to this already-running local task.
  The owning Dot must discover the new app and supply its own native callback.
- Connection-time callback destination validation is not yet implemented/proved;
  the Worker callback-origin allowlist remains empty.
- The owning Dot's subscription, unprompted fresh-nonce response, and subsequent
  cloud-task launch remain unverified. No Mac watcher, SMS route or polling task
  was installed.

## Sources

- [OpenAI connection steps](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI OAuth contract and exact redirect](https://developers.openai.com/plugins/build/auth)
- [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [OpenAI MCP Events lifecycle and callback validation](https://developers.openai.com/plugins/build/mcp-events)
