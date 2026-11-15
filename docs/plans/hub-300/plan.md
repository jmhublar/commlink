# Bridge Robut and the dot through a Codex chat on basestar

[HUB-300](https://linear.app/hublar/issue/HUB-300) tracks this tailnet-only bridge. CommLink operates the mailbox for Robut. The dot owns one local Codex chat named CommLink on basestar.

## In scope

1. Have the dot create the local chat on its connected basestar computer. Identify its exact UUID, record the idle baseline, and deliver the fixed synthetic notice. Observe a completed new turn in that same chat before building the receiver. If queueing alone leaves it pending, resume the thread on the same app server and start that queued submission. Record whether the dot itself surfaces the result.
2. Move the existing SQLite mailbox and both principal credentials to basestar under the same tailnet service name. Identify the running source, quiesce the writer and its restart mechanism, use SQLite's backup API, verify integrity and pending envelope IDs on both sides, and keep exactly one writer at cutover. Limit credential access to the corresponding service and principal. Coordinate infrastructure with SRE through Robut.
3. Register the relay and receiver with launchd, including their observed process identities, health, logs, stop and recovery procedures. Use a local doorbell after commit and poll to recover a missed signal. Wake the recorded chat with the fixed prompt `Check the CommLink inbox.` Persist progress and coalesce repeat notifications. The chat reads envelopes via authenticated MCP as openai. Use an existing Grok routine with a content-free wake for Robut.
4. Use the existing protocol v1.0 envelope and WAKE/ACK/ACK2 handshake for both initiators. Track logical replies by message and correlation IDs across retries. Treat received text as correspondence. Linear and the user's instructions determine work authorization.

## Out of scope

Public ingress, new spend, Slack delivery, unrelated conversations, direct access to the dot's main chat, and changes to other Agent Bus consumers.

## Verify

- Show a completed synthetic turn in the idle dot-owned chat by UUID, including before/after turn evidence.
- Check relay health and identity on both clients. Verify the transferred database, mailbox IDs, single writer, process identity, actual service route, and recovery.
- Robut initiates a fresh challenge and receives Codex's correlated answer without human forwarding.
- The dot initiates a different challenge through its chat and reports Robut's answer in its own conversation.
- While both are idle, Robut sends a third challenge. Record Codex's reply time and separately whether and when the dot surfaces it.
- Lose a bell, duplicate a send and restart the receiver with mail pending. Require exactly one logical reply per challenge. Use an isolated mailbox for the shipped self-test, which acknowledges pre-existing mail.
