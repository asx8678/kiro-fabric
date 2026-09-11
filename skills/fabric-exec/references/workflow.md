# Coding and repository workflow

This is task guidance, not permission. User tool/output constraints override generic workflow advice. If tools are forbidden, make no call, including computation, formatting, help or verification. Explain missing evidence without guessing. For JSON, keep permitted status, explanation, verification and blockers inside the requested schema; do not add fields to an exact schema or append a prose test summary.

For JSON-only requests, do not emit visible progress prose before or between tool calls. Kiro includes it in finalText. Keep reasoning private and produce only the requested final value; checking the last message alone is insufficient.

## Coding

Apply the standing acceptance ledger and completion rules. Keep working state in context, not new repository reports by default. Read applicable instructions and trace caller -> implementation -> defaults/overrides -> consumer -> tests before choosing a change. Include installation/build paths when they affect the result.

Batch related source with local.readMany and appropriate explicit ranges. Reuse returned totalLines; avoid metadata-only line-count reads. Follow remaining and relevant unreadTails without rereading prefixes. Keep known-schema transformations in the guest rather than copying raw data through the model. Follow the standing execution/yield policy. The [search→read recipe](recipes.md#discover-then-read) merges located source windows without a model handoff. Reserve aggregate output headroom for combined reads, evidence, diagnostics and continuation metadata, reducing per-read maxChars rather than losing coverage.

For a bug, reproduce the trigger and test a credible counterexample. For a feature, verify extension points, compatibility and failure behavior. For optimization, record a comparable before/after measurement; fewer lines or calls do not establish a speedup. Check which relevant runtimes and test commands are available early. Batch mechanical probes after understanding their inputs and effects, preserving each check's status and failure evidence.

Implement authorized work with targeted edits to current file contents; use create-only writes for needed new files. Verify public symbols, registrations, configuration and actual integration behavior. Run required repository checks/builds and repeat passing checks for concrete reasons, such as new failures or changed dependencies. An exit-zero wrapper or build alone is not completion. Never skip required checks to reduce credits.

Before handoff, reconcile every requested outcome and material lead with evidence. Continue productive investigation and independent work when one requirement is blocked. Preserve partial effects during recovery; do not replay blindly. Report passed, failed and not-run checks and specific blockers. Carry evidence and open checks across turns/compaction instead of restarting unchanged investigation. Kiro Auto controls model selection; working rules do not guarantee routing.

## Repository reviews

For audits, code review or broad project-improvement reviews, [review guidance](review.md) is optional task help via fabric.help({topic:"review"}), not an automatic first call. Explicit review mode selects its short contract; minimal/tool-only operation does not inject it. Known task paths bypass discovery. For unfamiliar layouts, default to discovery -> bounded observed starter reads in the same exec, deriving relevant readMany windows from find results rather than requiring list -> find or guessing files. Focused fixes and optimizations use the affected path and acceptance checks above, without inventing a whole-repo audit. Keep fetched ranges separate from traced paths/scenarios in the coverage ledger; see the single finding-evidence gate in review help. Account for every requested review area with evidence or an explicit limitation. Shared memory/state needs explicit session/task keys and revision checks; no global scratch ledger. Neither tool availability nor workflow advice authorizes fixes, probes or steering when forbidden.

## Complete reporting

Reduce narration, not verification. Give every requested result, supported finding, important tradeoff and material limitation enough explanation, with no arbitrary word target. Remove repeated explanation and intermediate output while retaining every requested result and supported finding. Respect explicit user length limits and exact output formats. Avoid opening pleasantries, repeated plan/recap, raw diffs or successful-command log dumps unless requested. Progress updates should mark meaningful milestones, plan changes or blockers, not each tool call; JSON-only rules above still suppress them.

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
