/**
 * Link filter — decides which discovered URLs to follow during crawling.
 * Priorities: /contact, /about, /team pages. Skips junk (images, PDFs, etc).
 */

/** File extensions to skip — not crawlable pages. */
const SKIP_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".rar", ".tar", ".gz",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp",
  ".mp3", ".mp4", ".avi", ".mov", ".wmv", ".flv",
  ".css", ".js", ".json", ".xml", ".rss", ".atom",
  ".woff", ".woff2", ".ttf", ".eot",
]);

/** URL path patterns that are unlikely to contain business contact info. */
const SKIP_PATTERNS = [
  /\/wp-admin/i,
  /\/wp-includes/i,
  /\/wp-json/i,
  /\/feed\/?$/i,
  /\/tag\//i,
  /\/category\//i,
  /\/page\/\d+/i,
  /\/cart/i,
  /\/checkout/i,
  /\/login/i,
  /\/register/i,
  /\/account/i,
  /\/privacy/i,
  /\/terms/i,
  /\/cookie/i,
  /\/sitemap/i,
  /\/cdn-cgi/i,
  /\/#/,
  /\/search/i,
  /\/blog\/\d{4}/i, // blog archive pages
];

/** High-priority paths — likely contain contact info. */
const PRIORITY_PATTERNS = [
  /\/contact/i,
  /\/about/i,
  /\/team/i,
  /\/staff/i,
  /\/people/i,
  /\/our-team/i,
  /\/meet-the-team/i,
  /\/leadership/i,
  /\/company/i,
  /\/who-we-are/i,
  /\/get-in-touch/i,
  /\/reach-us/i,
  /\/services/i,
  /\/locations/i,
];

/**
 * Determine if a URL should be followed.
 * Returns: "priority" | "follow" | "skip"
 */
export function classifyLink(
  url: string,
  baseDomain: string
): "priority" | "follow" | "skip" {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "skip";
  }

  // Only follow HTTP(S)
  if (!parsed.protocol.startsWith("http")) return "skip";

  // Stay on the same domain
  const linkDomain = parsed.hostname.replace(/^www\./, "");
  if (linkDomain !== baseDomain) return "skip";

  // Check file extension
  const pathLower = parsed.pathname.toLowerCase();
  for (const ext of SKIP_EXTENSIONS) {
    if (pathLower.endsWith(ext)) return "skip";
  }

  // Check skip patterns
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(parsed.pathname)) return "skip";
  }

  // Check priority patterns
  for (const pattern of PRIORITY_PATTERNS) {
    if (pattern.test(parsed.pathname)) return "priority";
  }

  return "follow";
}

/**
 * Sort links so priority pages come first.
 */
export function sortByPriority(
  links: string[],
  baseDomain: string
): string[] {
  const priority: string[] = [];
  const normal: string[] = [];

  for (const link of links) {
    const cls = classifyLink(link, baseDomain);
    if (cls === "priority") priority.push(link);
    else if (cls === "follow") normal.push(link);
    // skip → dropped
  }

  return [...priority, ...normal];
}
