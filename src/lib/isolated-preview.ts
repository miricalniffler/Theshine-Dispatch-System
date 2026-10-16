/**
 * A deliberately opt-in safety fence for the PR #12 cloud acceptance site.
 * The prefixed connection variables are created only for its disposable Neon
 * database. Production can never enter this mode, even if the integration
 * happens to expose the prefixed variables there too.
 */
// A test database must never become the backing store for another PR preview.
// Vercel exposes the Git ref as a system variable for Git-based deployments.
export const isIsolatedPreview =
  process.env.VERCEL_ENV === "preview" &&
  process.env.VERCEL_GIT_COMMIT_REF === "codex/core-workflow-recovery" &&
  Boolean(process.env.PR12_TEST_DATABASE_URL);

export function isolatedPreviewValue(name: "TEAM_ACCESS_TOKEN" | "TEAM_ACCESS_PASSWORD") {
  if (!isIsolatedPreview) return process.env[name];
  return name === "TEAM_ACCESS_TOKEN" ? process.env.PR12_TEST_TEAM_ACCESS_TOKEN : process.env.PR12_TEST_TEAM_ACCESS_PASSWORD;
}
