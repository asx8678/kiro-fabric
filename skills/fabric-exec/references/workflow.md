# Coding and repository workflow

This is task guidance, not permission. User tool/output constraints override generic workflow advice. If tools are forbidden, make no call, including computation, formatting, help or verification. Explain missing evidence without guessing. For JSON, keep permitted status, explanation, verification and blockers inside the requested schema; do not add fields to an exact schema or append a prose test summary.

For JSON-only requests, do not emit visible progress prose before or between tool calls. Kiro includes it in finalText. Keep reasoning private and produce only the requested final value; checking the last message alone is insufficient.

## Coding

Maintain an acceptance ledger, trace the affected path before editing, and verify requested public symbols, registrations and configuration. Search before bounded reads. Batch independent inspections; sequence dependencies. Keep known-schema data pipelines in one bounded execution instead of copying records through model context. Run targeted tests and direct behavioral probes when allowed; inspect failures rather than replaying effects. A build alone is not completion. Follow repository-required checks without overriding read-only constraints.

Never use decorative comment separator blocks of any kind. Use plain single-line comments and blank lines.

Read every user-provided file through an available read capability before content-dependent claims. local.read handles UTF-8 text only, inside the verified workspace; it is not an image/PDF viewer. For images or other unsupported inputs, use an actually available suitable capability or report the blocker and ask for accessible input. Never guess contents, bypass a tool ban, or change the coding workspace to the installation directory just to read guidance.

Never search the whole disk, user home or cwd ancestors. Do not run find, grep -r, fd, rg or ls against /, /Users, /Users/<user>, ~/, $HOME or any ancestor of cwd. Search only the named task/repository subtree; narrow on truncation.

## Git and GitHub

Reference: [GitHub review-comment reply API](https://docs.github.com/en/rest/pulls/comments#create-a-reply-for-a-review-comment).

Workflow instructions do not authorize commits, pushes or remote mutations. Never git reset --hard or git commit --amend unless explicitly asked. Preserve existing edits and staging. Create new commits and push normally when authorized, following repository commitlint/Conventional Commit standards. If work was wiped, inspect git reflog and recover available commits non-destructively; reflog cannot guarantee recovery of uncommitted edits.

For interactive commands use an appropriate noninteractive flag, GIT_EDITOR=true, EDITOR=true or --no-edit. Before opening a PR, locate, read and follow the repository PR template, including .github/PULL_REQUEST_TEMPLATE.md or its alternatives.

Never post, edit or delete GitHub comments on issues, PRs, reviews or discussions without explicit permission. Read-only gh pr view and gh api GETs are allowed, subject to normal network approval. With authorization, reply to a PR review comment in-thread via gh api repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies, never as a new parent comment. Supply the PR number and original top-level review-comment ID, not the GraphQL thread ID. Resolve the corresponding thread with the GraphQL resolveReviewThread mutation only after the reply succeeds and resolution is authorized. No pleasantries: state what changed, which commit and why.

Never pass PR, issue or comment Markdown inline as --body. Write it to a temporary file and use --body-file where that command supports it. gh api has no --body-file: encode a JSON request file and use --input, or use its file-backed body field. Keep Markdown out of shell command strings. Use git commit -F for Markdown commit messages. File-backed data still needs safe path quoting and exact approval; it never grants permission to post.
