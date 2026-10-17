/**
 * A deliberately opt-in safety fence for the PR #12 cloud acceptance site.
 * The prefixed connection variables are created only for its disposable Neon
 * database. Production can never enter this mode, even if the integration
 * happens to expose the prefixed variables there too.
 */
// A test database must never become the backing store for another PR preview.
// Vercel exposes the Git ref as a system variable for Git-based deployments.
const isolatedPreviewBranches = new Set(["codex/core-workflow-recovery", "codex/ai-assist-phase1"]);

export const isIsolatedPreview =
  process.env.VERCEL_ENV === "preview" &&
  isolatedPreviewBranches.has(process.env.VERCEL_GIT_COMMIT_REF ?? "") &&
  Boolean(process.env.PR12_TEST_DATABASE_URL);

// A preview without its dedicated test connection must fail closed instead of
// silently inheriting any business database connection configured for another
// environment.
export const isUnisolatedPreview = process.env.VERCEL_ENV === "preview" && !isIsolatedPreview;

export function isolatedPreviewValue(name: "TEAM_ACCESS_TOKEN" | "TEAM_ACCESS_PASSWORD") {
  if (!isIsolatedPreview) return process.env[name];
  return name === "TEAM_ACCESS_TOKEN" ? process.env.PR12_TEST_TEAM_ACCESS_TOKEN : process.env.PR12_TEST_TEAM_ACCESS_PASSWORD;
}
