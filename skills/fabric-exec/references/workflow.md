# Coding and repository workflow

Task guidance, not permission. The user's tool and output constraints always win: if tools are forbidden, make no call at all, including computation, formatting, help or verification. Explain what evidence is missing instead of guessing.

## Output format

- For JSON output, keep status, explanation, verification and blockers inside the requested schema. Do not add fields to an exact schema or append a prose summary.
- For JSON-only requests, write no visible text before or between tool calls: Kiro includes it in the final answer. Produce only the final value.

## Coding

- Read the repository's own instructions (AGENTS.md, CONTRIBUTING, README) when they apply.
- Trace the path that matters: caller, implementation, defaults and overrides, consumers and tests, including build or install steps that affect the outcome.
- Batch related source with `local.readMany`. Reuse returned `totalLines` instead of re-reading for line counts. Follow `remaining` and relevant `unreadTails` without rereading prefixes. The [search→read recipe](recipes.md#discover-then-read) combines located windows without a model round trip.
- Keep known-schema transformations inside the program instead of copying raw data through the conversation. Lower per-read `maxChars` rather than losing coverage when combining results.

A cause is found when you can point to the code that produces the wrong behavior and a read or run that shows it; until then it is a hypothesis. This evidence is yours to gather, so a gap in it is not a reason to stop or ask:

- The full error output and every stack frame that matters, not only the last line.
- A minimal reproduction: the smallest command, test or script that shows the failure.
- Dependency and tool source inside the workspace (for example `node_modules`) and installed versions, instead of assumptions about their behavior.
- The environment the code really runs in: configuration, environment variables, working directory, build output versus source, stale caches.
- History: `git log -p` and `git blame` on the lines involved.
- Real values from a probe script, or from temporary logging when edits are authorized. Keep scratch scripts outside the repository or delete them, and remove temporary logging before finishing.

Once a cause is confirmed, search for the same pattern in sibling code; every instance the request covers is part of the fix.

Match verification to the kind of change:

- **Bug:** reproduce the trigger first, then confirm the fix removes it and check a credible counterexample.
- **Feature:** check extension points, compatibility and failure behavior.
- **Optimization:** record a comparable before/after measurement; fewer lines or calls do not prove a speedup.

Find out early which runtimes and test commands are available. Run the repository's required checks and builds; an exit-zero wrapper or a build alone is not completion. Re-run a passing check only when something it depends on changed.

For multi-step work, keep track of which checks passed, failed or have not run, and resume from the next open one after an interruption or compaction. Preserve partial effects during recovery rather than redoing work.

## Repository reviews

[Review help](review.md) (`fabric.help({topic:"review"})`) has detailed mechanics; load it only when a review needs them. Locate code with Navigator, read the observed source, use `repo.impact` before conclusions about changes, and fall back to bounded `local.find`/`local.grep` when analysis is unavailable. Conversation and forbidden tools never trigger navigation.

## Reporting

- Report outcomes, verification and material limitations. Skip pleasantries, raw diffs and logs of successful commands unless asked.
- Return only decision-relevant evidence from programs: changed paths, check names and status, failure diagnostics, truncation flags.
- Keep warnings and uncertainty. Do not turn an exit-zero build into "all tests passed". Report only checks actually run, and mark delegated results as reported rather than verified.

Do not add code comments or write, add, or modify tests unless the user explicitly requests them. Preserve existing comments and tests unless the user asks to change them. Existing tests, builds, and read-only checks may be used for verification.

## Files and search scope

- Read every file the user points to before relying on its contents. `local.read` handles UTF-8 text inside the verified workspace only; for images or other formats, use a suitable available capability or ask for accessible input. Never switch the workspace to the Fabric installation just to read guidance.
- Search only the task's project subtree. Never run find, grep -r, fd, rg or ls against `/`, home directories or ancestors of the workspace. Narrow truncated searches.

## Git and GitHub

Reference: [GitHub review-comment reply API](https://docs.github.com/en/rest/pulls/comments#create-a-reply-for-a-review-comment).

- Workflow guidance never authorizes commits, pushes or remote changes. Never `git reset --hard` or `git commit --amend` unless explicitly asked. Preserve existing edits and staging.
- When authorized, create new commits following the repository's commit conventions (commitlint/Conventional Commits) and push normally. If work was lost, inspect `git reflog` and recover commits non-destructively; uncommitted edits may not be recoverable.
- Use noninteractive flags for interactive commands (`GIT_EDITOR=true`, `EDITOR=true`, `--no-edit`). Before opening a PR, read and follow the repository's PR template (for example `.github/PULL_REQUEST_TEMPLATE.md`).
- Never post, edit or delete GitHub comments on issues, PRs, reviews or discussions without explicit permission. Read-only `gh pr view` and `gh api` GETs are fine, subject to network approval.
- With authorization, reply to a PR review comment in its thread via `gh api repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies`, using the PR number and the original top-level review-comment ID (not the GraphQL thread ID). Resolve the thread with the GraphQL `resolveReviewThread` mutation only after the reply succeeds and resolution is authorized. State what changed, in which commit and why.
- Never pass Markdown inline as `--body`. Write it to a temporary file and use `--body-file`; `gh api` has no `--body-file`, so use a JSON request file with `--input`. Use `git commit -F` for Markdown commit messages. File-backed content still needs exact approval and never grants permission to post.
