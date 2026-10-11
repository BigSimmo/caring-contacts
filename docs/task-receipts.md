# Caring Contacts: task lifecycle and receipt handoff

Owning repository: `BigSimmo/caring-contacts`. One existing canonical task source owns this project. Obtain its destination through the approved coordinator or private owner mapping; never invent or create a competing ledger. The receipt is a reconciliation handoff, not proof of delivery.

Reuse [NEXT-STEPS](NEXT-STEPS.md), the existing clinical handover and approval receipts. Historical Done in this copy is not fresh clinical or provider approval.

## Update at lifecycle events

At start, reuse the original objective/task ID. At checkpoint, blocker, resume and completion, update that same record; retries and terminal assistant turns are not new tasks or proof of completion. One project owns each task. Link dependencies as project plus task ID instead of copying them into other project lists. Keep Completed/Cancelled history; open views hide those states.

Status is In progress, Blocked, Needs you, Paused, Completed or Cancelled. Record Task/title, Blocker, Next action, Owner and source/evidence links in the canonical source where authorised. Preserve Last verified unless new evidence actually verifies the state. Completion needs evidence of the task's acceptance; completion, user acceptance, merge, release and deployment remain separate.

When code/config/instructions change, refresh the relevant maintained document and same task receipt as part of the owned diff. Respect file claims; hand conflicting document updates to their owner. Do not regenerate unrelated docs. Changes to these rules need the same reviewed documentation process. Shared master/adapters are maintained separately; do not edit them from this project task.

## Local-only receipt bridge

`python scripts/export-task-receipt.py --input <sanitised-metadata.json> --output-directory <private-task-workspace>` writes a deterministic per-project/per-task JSON file. Python 3 is required; no packages, service, network or API key is used. Output stays local; an authorised parent session must verify its destination and reconcile it. Use one exporter writer per task. Do not place private receipt inputs in tracked Git.

Schema version 1: project, repository, source_identity (`repository:task_id`), observed_head, stale_source and task. Task allowlist: task_id, title, status, lifecycle (start/checkpoint/blocked/complete), blocker, next_action, evidence (locations only), last_verified (timezone-aware ISO timestamp or null), source_reference, source_revision, dependencies (project/task_id pairs), sanitised (true). Stable identity must be searched before creating a canonical row. Source reference is the existing task/checkpoint link, not full chat text.

Prepare the input manually or through an observable supported client event. Explicitly sanitise it: no transcripts, patient details, identifiers, credentials, .env contents or full log capture. The allowlist is not a content redactor. The exporter reads only the supplied bounded JSON and Git identity/revision. It does not open evidence locations. It rejects wrong repositories, unsupported fields/statuses, completion without evidence/time, and refreshing Last verified against unchanged evidence and revision. It flags a missing/mismatched source revision as stale; human review must also assess dirty inputs, dependencies and age. A receipt cannot prove its own factual claims.

Accessible task results are reconciled by the parent's bounded hourly process. Inaccessible desktop, CLI, IDE and other chats have no universal event subscription here: their client must emit the receipt or the owner must hand it over. No real-time coverage or external delivery is claimed. Export success is not reconciliation success.

## Client loading and contributions

Codex and Cursor Agent use the root AGENTS.md. Claude Code uses CLAUDE.md and its @AGENTS.md import. Gemini CLI uses GEMINI.md by default; this adapter directs the session to applicable project safeguards and this procedure. Antigravity supports AGENTS.md/GEMINI.md, but its documented rule-file/aggregate budgets can truncate large project chains; inspect native loaded context before claiming coverage. No Cursor duplicate rule or Antigravity copy is required solely to repeat the same AGENTS guidance.

Use the supported global adapter for shared master preferences; the maintained source is the user's ai-rules/global-rules.md. Propose evidence-backed shared changes to that source's owner; update relevant owned project documentation and the same task receipt locally. Do not copy the master or create another ledger. A source change, a file sync and actual loaded context are separate evidence states.

To activate these branch-only changes without touching active canonical work, select this prepared task worktree as the client's workspace and start a fresh session (or use a supported context reload and verify it). Canonical checkout activation requires its reviewed repository integration workflow. An existing chat can retain older context; file changes do not retroactively enforce instructions. No universal event capture is installed.
