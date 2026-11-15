# Provision Grok webhook settings through GitHub

The manual **Configure Grok webhook** workflow copies GitHub environment secrets
to encrypted bindings on the existing `commlink-prototype` Worker. It updates
settings only; it does not upload Worker code, create a routine, or send a wake.
The Grok transport is implemented. Live wake/reply evidence remains a separate acceptance gate.

## GitHub environment

The `commlink-prototype` environment exists in `jmhublar/commlink` and permits
only the `main` branch. Its nonsecret target variables are already set:

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | `32b597c6685caac8796fc167932759d2` |
| `CLOUDFLARE_WORKER_NAME` | `commlink-prototype` |

In **Settings → Environments → commlink-prototype**, Joshua supplies:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare token with Workers Scripts Edit for the recorded account |
| Secret | `GROK_WEBHOOK_URL` | Complete routine URL, including any credential in its path/query |
| Secret | `GROK_SENDER_KEY` | Routine sender key |
| Variable | `GROK_AUTH_HEADER` | `Authorization` (verified vendor contract) |
| Variable | `GROK_AUTH_SCHEME` | `Bearer` (verified vendor contract) |
| Variable | `GROK_WEBHOOK_ORIGIN` | `https://api2.cursor.sh` (Joshua confirmed) |
| Variable | `GROK_ENABLED` | `true` to enable, `false` to pause |
| Variable | `GROK_CONFIG_REVISION` | Operator revision, initially `1`; bump after fixing a blocked/exhausted transport |

Both webhook secrets are required for each run. Set both auth variables together
using the verified values above. If both are absent, existing auth
bindings are preserved; this lets credentials be provisioned before the contract
is known. Enabling also requires an explicit origin and revision. Missing/invalid runtime
configuration prevents egress. The exact origin must match the secret URL.

Use environment secrets, not repository-wide secrets. The Cloudflare token is
used only by CI and is never included in Worker settings. No credentials are
needed in Linear, chat, committed files or workflow inputs. The token can edit
Workers in the selected account: keep its account scope restricted.

The GitHub UI accepts values directly. Alternatively these CLI commands prompt
for secrets without putting their values in shell command arguments:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo jmhublar/commlink --env commlink-prototype
gh secret set GROK_WEBHOOK_URL --repo jmhublar/commlink --env commlink-prototype
gh secret set GROK_SENDER_KEY --repo jmhublar/commlink --env commlink-prototype
```

## Apply and verify

1. Review and merge PR #1 through the normal process. GitHub needs this workflow
   on the default branch before it can be manually dispatched. This setup does
   not merge the PR.
2. Provision the three secrets and any confirmed auth variables in the environment.
3. Under **Actions → Configure Grok webhook → Run workflow**, select `main`.
   Equivalently, after merge:

   ```sh
   gh workflow run configure-grok-webhook.yml --repo jmhublar/commlink --ref main
   ```

4. The workflow runs dependency-free configuration tests without secrets, then
   provides credentials only to the configuration step. It validates the target,
   requires the latest uploaded Worker version to be fully deployed, reads live
   binding names, and sends one settings PATCH containing both secret updates.
   Other bindings are inherited, including unreadable secrets and the existing
   `MAILBOX` namespace. No stale identity map or callback allowlist is replayed
   from `deployment.json`.
5. The final read verifies expected binding names/types and nonsecret variable
   values. Secret values cannot be read back. Success proves configuration was
   accepted; it does not prove a Grok run, mailbox receipt or reply. Enabling the
   adapter allows subsequent alarms/sends to deliver pending mail.

The workflow serializes its own runs. Avoid simultaneous dashboard changes or
other deployments: the Cloudflare settings API has no compare-and-swap guard
here, and the pre-write version check cannot eliminate an external race. Staged
versions or gradual deployments must be resolved before running this workflow.
Cloudflare may create a new Worker version/deployment for a settings change.

API responses and exception details are suppressed because they can echo secrets.
If a write times out or verification fails, the job reports an uncertain outcome;
inspect binding names in Cloudflare before rerunning. There is no automatic retry
or rollback that could overwrite a concurrent change. Rotate credentials by
updating the GitHub environment secrets and rerunning this same workflow.

Local use is also supported with the same environment variables already injected
by a trusted secret manager: `node cloudflare/scripts/configure-webhook.mjs` from
the repo root. Do not type secret values into commands, use shell tracing, or
commit `.env` / `.dev.vars` files. The script uses Node 24 in CI and no npm packages.

## What Grok needs to prepare

See the handoff in [HUB-300](https://linear.app/hublar/issue/HUB-300/robut-openai-agent-channel-mcp-over-tailscale)
and [wake design](../docs/plans/hub-300/grok-wake.md). The service identities and
Worker secrets are now provisioned. The vendor auth contract and endpoint origin
are verified. The adapter has local delivery/coalescing/reconciliation tests;
prove the enabled routine and fresh-nonce round trip next. Existing Worker secret
bindings can be inherited during connector deployment without copying them into
GitHub first. GitHub secrets support later operator-managed rotations.

References: [Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/edit/),
[GitHub environment secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
[manual workflow dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).
