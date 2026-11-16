# HUB-300 native wake acceptance — 2026-11-15

This is the native Grok→existing owning Dot→Robut acceptance record. It is separate
from the earlier OpenAI→Grok routine test. Only synthetic correspondence was sent.
No manual prompt or mailbox poll by the implementation child was used to wake
or answer for the owning Dot. A posted status report is not a reply from that Dot.

## Evidence stages

| Stage | Evidence | Limit |
| --- | --- | --- |
| Native subscription | Parent created saved watch6afa3cbcdfcc81918d1729962633362c in owning thread01a1a687-6ecc-75ab-a47f-692abf9d200e; accepted subscription sub_088f202e1a5fa3c38e799fb0ec2d6022ff9e482ce2a57f8b5f9ef7486c893a69 | One-hour grant; renewal past expiry not tested here. |
| Scoped request to Robut | Messagebc2d1f68-9631-409f-847c-894108add2c0, correlationda893f39-2fd9-4dd4-84e2-14c7129ec3ea; requested one fresh Robut nonce, one Dot echo, Linear-only completion | Send acceptance is storage, not receipt. |
| Robut challenge | Message123c2996-b2bd-4bd1-82c1-deda8b27375f arrived from Robut | The child did not consume or answer it. |
| Signed event delivery | Eventevt_958224df-6950-41d2-88e0-51bd5547fa62 accepted HTTP200, attempt1 | Callback acceptance alone is not wake proof. |
| Actual owning-Dot wake | Parent independently reported this native event woke the existing thread without a manual prompt; it read and acknowledged the challenge | Native watch metadata records run23:17:09.608343Z, but its null detailed run history is not independent proof of execution. |
| Exact correlated echo | Owning Dot reports one verbatim nonce echo, messagefa710acc-b01a-4b85-b1e5-172410e4d9e2, same correlation | This child's evidence source for nonce equality is the owning Dot's report; no raw nonce/secret copied here. |
| Robut receipt | Grok wakegrok_e6e4751d-9df5-4ecc-82a4-61b8536054a4 for the echo reached drained; a Robut-authenticated completion reports receipt/ack | Receipt is distinct from webhook200. |
| Extra completion | Robut sentbfeb184f-1e53-4592-a845-ea5aed07fa55; eventevt_ae63ad3e-45fa-49d4-9a29-48b0c181f27e accepted HTTP200, attempt1 | Deviates from the request to report completion only in Linear; caused one extra Dot wake. |
| Completion handling | Parent reports second native event woke Dot; it acknowledged the no-action completion and did not reply | Latest native watch run time23:18:43.180798Z corroborates scheduling; detailed history unavailable. |

The test demonstrates actual native wake and correlated response, followed by
Robut receipt. It does not establish that Robut followed the requested
Linear-only completion convention: it sent an extra completion message.

## Bounded loop observation

Loop observation started2026-11-15T23:19:53Z after completion acknowledgment.
Baseline: openai pending0, two native delivery records (challenge and completion),
both accepted once; original echo's Grok state drained. No additional challenge
or echo was sent by the implementation child.

An unrelated openai→robut message6b006d41-4abe-48e6-b3e7-0581182763d3 with a different
correlationb266c559-45f5-46c0-b6ca-e4df9b27ba49 was observed in Grok status. It is
not attributed to this acceptance run; concurrent traffic can affect aggregate
counters. Report only observed run-specific results, not an eternal no-loop guarantee.

Final observation2026-11-15T23:21:59Z,126seconds after baseline: openai pending0,
still exactly the same two accepted delivery records at attempt1 each, original
echo's Grok wake still drained. No additional native delivery or original-run
reply was observed. The finite no-recurring-loop check passes for this window;
the extra completion-message deviation remains. Different-correlation traffic
continued separately and is excluded. See the adjacent JSON counter snapshot.

## Operational and review state

Worker runtime7ca277b, current configuration version8b283d8f-c5e7-47f2-95bb-e1653dd01b1e,
private VPC transport reachabletrue. Gateway still supervised by K3s/Flux Helm.
CommLink code+deployment-record review179d04d completed clean. SysOp review found
that its initial three-case test omitted a wrong-label Pod in the allowed
namespace; fixed in17eaf7f with a fourth bounded Job. All four live cases passed,
all Jobs removed, policy unchanged. Re-review17eaf7f completed clean. Neither PR
has merged; main-branch GitOps adoption remains pending review/merge workflow.

HUB-300 comments retain the observed stages and parent reports. No callback
capability URL, signing secret, signature or service credential was retained.
