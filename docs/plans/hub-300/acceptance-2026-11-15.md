# HUB-300 live acceptance — 2026-11-15

The **OpenAI → Grok wake → Robut reply → OpenAI receipt** exchange passed.
The receiving OpenAI process polled; automatic wake of Joshua's existing Dot is
still unproved because there were zero OpenAI MCP event subscriptions.

## Evidence

| Stage | Observed result |
| --- | --- |
| Deployed code | `f35d530ed6eddffaeb9ab3a0b8786ffb96bb5052`; Cloudflare returned version `1402a91ff9d1426a8599e657b15cd422` |
| Authenticated sender | Actual GPT service credential initialized and returned `self: openai`; credential decoded only in local process memory |
| Message stored | `cd1a7725-d1bf-4d0f-93eb-7e658bcda974`, server sequence 1, status accepted / doorbell queued |
| Correlation | `fd8befc7-b6f1-4e82-9f6d-5cb9b99c13e0` |
| Initial webhook | `grok_1fbc0153-f975-46a8-acd9-f4ff5dcd14b5`, HTTP 200 on attempt 1 |
| Recovery | Accepted-but-unprocessed mail caused fresh reconciliation events; third event `grok_f536a21d-87e3-4731-9371-1e8077ec828b` was reported by Robut as the actual routine trigger |
| Robut receipt | Robut reported polling with its own service identity and `acked` for the original message |
| Correlated reply | `d5ba8050-4981-4e91-aa66-cab430be8982`, MSG, server sequence 2; independently fetched by OpenAI and exact synthetic nonce matched |
| OpenAI receipt | Actual OpenAI `ack` returned `acked` for the reply |
| No loop | Subsequent status showed OpenAI pending 0, same Grok event still drained, and no replacement wake |

Robut's [Linear evidence](https://linear.app/hublar/issue/HUB-300/robut-openai-agent-channel-mcp-over-tailscale)
(comment `c30eb5e6-68cc-4266-a10f-6301738ec57f`) reports that the first routine run
failed because it lacked the endpoint URL. The later run polled, acknowledged and
replied. Thus HTTP 200 by itself was insufficient, and durable reconciliation
recovered this real acceptance run. The desktop UI could not be inspected because
two accessibility requests timed out; run history is corroborated by Robut's
comment and the independently observed authenticated reply, not by a UI capture.

## Review and configuration

The 33-test adapter suite passed before deployment. Fresh PR review found one P2
race: replacing an event during an in-flight 429 could discard Retry-After. A
regression reproduced the extra POST at 20 seconds despite a 300-second cooldown.
The fix persists that cooldown in recipient control state before the stale-event
guard. All 34 tests pass after the fix; deployment/review revisions are recorded
in `cloudflare/deployment.json` and PR #1. Fix commit `3f307f2` was deployed as
version `81cff0ad8ed74aadaece273a20273d3e`; the post-deploy authenticated check
retained the drained event and empty OpenAI inbox.

Webhook URL/key bindings remained encrypted and were inherited, never exported.
GitHub environment names verified: `GROK_WEBHOOK_URL` and `GROK_SENDER_SECRET`.
The workflow accepts the latter as an alias for the Worker binding
`GROK_SENDER_KEY`. A future GitHub configuration run still needs
`CLOUDFLARE_API_TOKEN`; connector deployment already works without that CI token.
No PR merge, paid-plan upgrade, old-relay cutover or local watcher installation
was performed.

## Remaining acceptance gates

- Connect the private ChatGPT plugin through Cloudflare Access and establish a
  real event subscription owned by Joshua's existing Dot. The callback-origin
  allowlist is still empty; OAuth redirect/DCR setup and callback validation remain.
- Deliver a fresh nonce to that subscribed Dot and observe its own response.
- Saved cloud-environment task launch is a further gate, separate from delivery.

The proposed macOS watcher is a different local execution path. It has not been
installed or enabled and is not evidence that the existing cloud Dot can wake.
