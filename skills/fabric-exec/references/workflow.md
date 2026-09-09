# Coding and repository workflow

This is task guidance, not permission. User tool/output constraints override generic workflow advice. If tools are forbidden, make no call, including computation, formatting, help or verification. Explain missing evidence without guessing. For JSON, keep permitted status, explanation, verification and blockers inside the requested schema; do not add fields to an exact schema or append a prose test summary.

For JSON-only requests, do not emit visible progress prose before or between tool calls. Kiro includes it in finalText. Keep reasoning private and produce only the requested final value; checking the last message alone is insufficient.

## Coding

Keep a small acceptance ledger in working context, not a new repository file by default:

1. Translate the request into observable checks and the requested output contract. Separate requirements from optional cleanup.
2. Trace the affected execution path before editing. Search before bounded reads; batch independent inspections and sequence dependencies. Keep known-schema data pipelines in guest variables, not model round trips.
3. Implement the smallest complete change. Mechanically verify requested public symbols, registrations and configuration; substring presence alone does not establish correctness.
4. Run the smallest targeted tests and direct behavioral probes covering the ledger. Inspect nonzero exits with local.shell settle:true and preserve relevant diagnostics. A build alone is not completion. Escalate for failures, changed dependencies or cross-cutting risk; do not rerun unchanged passing checks unless repository rules require it. Follow required checks/builds without overriding tool bans or read-only constraints.
5. Stop when each requirement has evidence or an explicit blocker. Distinguish passed, failed and not-run checks; an execution succeeding is not proof that its returned checks passed. Inspect partial effects before recovery, never replay them blindly.

## Repository reviews

For audits, code review or project-improvement requests, apply [review guidance](review.md) via fabric.help({topic:"review"}). A coding acceptance ledger alone does not establish review coverage: trace high-risk scripts, overrides and consumers; record incomplete reads and unresolved leads. Correctness and coverage precede reducing calls.

## Concise reporting

Reduce narration, not verification. For routine outcomes default to concrete check results and unresolved blockers in <=120 words; reviews/audits are exempt, and explicit detail or complete output requests override this. Keep each finding concise without limiting the number of supported findings. No opening pleasantries, repeated plan/recap, raw diffs or successful-command log dumps unless requested. Progress updates should mark meaningful milestones, plan changes or blockers, not each tool call; JSON-only rules above still suppress them.

Choose the needed return shape before execution. Keep intermediate records and routine logs in guest variables; return only decision-relevant evidence such as changed paths, check names/status, failure diagnostics and truncation/omission flags. Inspect relevant output before reducing it. Preserve warnings and uncertainty; do not translate an exit-zero build into "all tests passed". Report only checks actually run, identifying delegated evidence as reported rather than independently verified. Do not claim live model-quality or token-cost improvements from static prompt tests.

Never use decorative comment separator blocks of any kind. Use plain single-line comments and blank lines.

Read every user-provided file through an available read capability before content-dependent claims. local.read handles UTF-8 text only, inside the verified workspace; it is not an image/PDF viewer. For images or other unsupported inputs, use an actually available suitable capability or report the blocker and ask for accessible input. Never guess contents, bypass a tool ban, or change the coding workspace to the installation directory just to read guidance.

Never search the whole disk, user home or cwd ancestors. Do not run find, grep -r, fd, rg or ls against /, /Users, /Users/<user>, ~/, $HOME or any ancestor of cwd. Search only the named task/repository subtree; narrow on truncation.

## Git and GitHub

Reference: [GitHub review-comment reply API](https://docs.github.com/en/rest/pulls/comments#create-a-reply-for-a-review-comment).

Workflow instructions do not authorize commits, pushes or remote mutations. Never git reset --hard or git commit --amend unless explicitly asked. Preserve existing edits and staging. Create new commits and push normally when authorized, following repository commitlint/Conventional Commit standards. If work was wiped, inspect git reflog and recover available commits non-destructively; reflog cannot guarantee recovery of uncommitted edits.

For interactive commands use an appropriate noninteractive flag, GIT_EDITOR=true, EDITOR=true or --no-edit. Before opening a PR, locate, read and follow the repository PR template, including .github/PULL_REQUEST_TEMPLATE.md or its alternatives.

Never post, edit or delete GitHub comments on issues, PRs, reviews or discussions without explicit permission. Read-only gh pr view and gh api GETs are allowed, subject to normal network approval. With authorization, reply to a PR review comment in-thread via gh api repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies, never as a new parent comment. Supply the PR number and original top-level review-comment ID, not the GraphQL thread ID. Resolve the corresponding thread with the GraphQL resolveReviewThread mutation only after the reply succeeds and resolution is authorized. No pleasantries: state what changed, which commit and why.

Never pass PR, issue or comment Markdown inline as --body. Write it to a temporary file and use --body-file where that command supports it. gh api has no --body-file: encode a JSON request file and use --input, or use its file-backed body field. Keep Markdown out of shell command strings. Use git commit -F for Markdown commit messages. File-backed data still needs safe path quoting and exact approval; it never grants permission to post.
