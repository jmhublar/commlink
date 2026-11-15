# Native Dot wake setup

Native MCP Events is Joshua's selected default for HUB-300. The private plugin
is version 0.1.1; its skill preserves that choice, reuses a matching subscription,
handles mailbox recovery and deduplication, and separates receipt from work.
This is a configured instruction default, not a completed live subscription.

## Credentials

The Desktop GPT client ID and secret are Cloudflare Access **service-token**
credentials. They already authenticated the tested local OpenAI mailbox client.
They are not OAuth client credentials and must not be pasted into ChatGPT's
OAuth client ID/secret fields.

Cloudflare Access Managed OAuth handles the separate ChatGPT user login.
Dynamic client registration (DCR) creates its OAuth client registration. There
is no manually generated API key to obtain for this path.

## ChatGPT connection

Use the existing CommLink server's connection/manage screen if available. The
packaged private plugin currently shows one MCP server and one skill, but no
connected tools/events or OAuth connection controls were visible on its web page.
OpenAI also documents Plugins → Add → Add custom MCP server for creating the
authenticated server connection. Do not repeatedly create duplicate entries.

Use these settings in that connection form:

| Field | Value |
| --- | --- |
| Name | CommLink |
| Description | Private HUB-300 agent mailbox and native message events |
| Connection | Public HTTPS / Streamable HTTP |
| MCP server URL | https://commlink-prototype.joshua-m-hublar.workers.dev/mcp |
| Authentication | OAuth |
| Client registration | Dynamic client registration, if explicitly offered |
| OAuth client ID / secret | Leave unset when using DCR; do not substitute the service-token files |

Copy the exact **OAuth redirect URI** shown by ChatGPT's management/setup screen.
This URI is nonsecret; it is different from the later event-delivery URL. If the
form provides no redirect or fails first, retain the exact error and stop rather
than guessing a callback or inserting a service key.

## Access configuration and login

The existing Access application is `84582df9-1583-4e5c-b0ec-770708c448d3`.
Managed OAuth is already on, but DCR remains off and allowed redirects are empty.
After obtaining ChatGPT's actual redirect:

1. Preserve the application's hostname, immutable Worker association, all owner
   and service policies, and existing session lifetimes.
2. Allowlist only the exact ChatGPT redirect and enable DCR.
3. Retry Connect in ChatGPT and complete the normal Cloudflare identity login as
   the existing allowed owner. Cloudflare generates the OAuth tokens.
4. Confirm the discovered tools are `send`, `poll`, `ack`, `link_status`, and the
   event is `commlink.message.created`. Refresh/rescan metadata if needed.
5. Confirm authenticated `link_status.self` is `openai`.

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

## Observed setup blockers, 2026-11-15

- The private plugin's web shortcut opens ChatGPT desktop. Computer-use access to
  `com.openai.codex` was explicitly denied for safety reasons; it was not retried.
- The web directory's Add menu did not expand using available semantic controls,
  including after a refresh. No connection was created through that route.
- No CommLink connection/subscription tool is exposed to this local task.
- OAuth redirect/DCR, callback transport validation and an owning-Dot subscription
  still need completion. No Mac watcher, SMS route or polling task was installed.

## Sources

- [OpenAI connection steps](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI OAuth contract and exact redirect](https://developers.openai.com/plugins/build/auth)
- [Cloudflare Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)
- [OpenAI MCP Events lifecycle and callback validation](https://developers.openai.com/plugins/build/mcp-events)
