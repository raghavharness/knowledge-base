/**
 * Shared URL utility functions for PR/repo URL validation and extraction.
 */

/**
 * Validate that a URL is an actual PR link (GitHub or Harness Code), not a
 * JIRA link, Confluence page, or other non-PR URL.
 */
export function isValidPrUrl(url: string): boolean {
  // GitHub PR: https://github.com/owner/repo/pull/123
  if (/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url)) return true;
  // Harness Code PR: .../repos/REPO/pulls/123 or .../repos/REPO/pullreq/123
  if (/\/repos\/[^/]+\/pull(?:s|req)\/\d+/.test(url)) return true;
  return false;
}

export function extractPrNumber(url: string): string {
  const match = url.match(/\/(?:pull|pulls|pullreq)\/(\d+)/);
  return match ? match[1] : "0";
}

export function extractRepoFromUrl(url: string): string {
  // GitHub: https://github.com/owner/repo/pull/123
  const ghMatch = url.match(/github\.com\/([^/]+\/[^/]+)/);
  if (ghMatch) return ghMatch[1];

  // Harness: .../repos/REPO_NAME/pulls/...
  const harnessMatch = url.match(/\/repos\/([^/]+)\//);
  if (harnessMatch) return harnessMatch[1];

  return "";
}

export function extractRepoUrl(prUrl: string): string {
  // GitHub: return repo URL without /pull/N
  const ghMatch = prUrl.match(/(https:\/\/github\.com\/[^/]+\/[^/]+)/);
  if (ghMatch) return ghMatch[1];

  return "";
}
