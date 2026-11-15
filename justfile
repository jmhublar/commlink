default:
    @just --list

# Exercise the real relay and doorbell using throwaway state and loopback-only ports.
relay-selftest:
    uv run --offline --no-cache --no-project tools/isolated_selftest.py

# Prove a WAL-backed mailbox copy and detect post-copy database or credential changes.
snapshot-check:
    uv run --offline --no-cache --no-project tools/test_mailbox_snapshot.py

# Create a private migration bundle. The operator must first quiesce the source supervisor and writer.
[positional-arguments]
mailbox-snapshot source destination:
    uv run --offline --no-cache --no-project tools/mailbox_snapshot.py create "$1" "$2"

# Check a transferred bundle. Optionally supply --against SOURCE for direct reconciliation.
[positional-arguments]
mailbox-verify snapshot *args:
    uv run --offline --no-cache --no-project tools/mailbox_snapshot.py verify "$@"

# Add the tailnet relay to the current user's Codex config. The credential is supplied at runtime.
codex-connect:
    codex mcp add comlink --url https://svc-commlink.tailbde0eb.ts.net/mcp --bearer-token-env-var COMLINK_RELAY_TOKEN

# Verify vendor request contents and credential handling without contacting Grok.
routine-check:
    uv run --offline --no-cache --no-project tools/test_grok_routine.py
