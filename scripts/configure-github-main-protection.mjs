#!/usr/bin/env node
// One-time repository administration. Requires a GitHub token with repository
// administration permission; source changes alone cannot enforce these rules.
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY ?? "asx8678/kiro-fabric";
if (!token) throw new Error("GH_TOKEN with repository administration permission is required");
const api = async (pathname, init = {}) => {
  const response = await fetch(`https://api.github.com/repos/${repository}${pathname}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${pathname}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? undefined : response.json();
};
await api("/branches/main/protection", {
  method: "PUT",
  body: JSON.stringify({
    required_status_checks: {
      strict: true,
      contexts: [
        "check (ubuntu-latest, Node 24)",
        "check (macos-latest, Node 24)",
        "check (windows-latest, Node 24)",
        "reproducible Power closure",
      ],
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: true,
      required_approving_review_count: 1,
      require_last_push_approval: true,
    },
    restrictions: null,
    required_conversation_resolution: true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: false,
    required_linear_history: true,
    lock_branch: false,
    allow_fork_syncing: true,
  }),
});
await api("/branches/main/protection/required_signatures", { method: "POST" });
process.stdout.write(`Protected ${repository}:main with required CI jobs and code-owner review\n`);
