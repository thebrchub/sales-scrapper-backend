/**
 * URL frontier — manages the BFS queue of URLs to crawl.
 * Tracks visited URLs, depth per URL, and domain visit counts.
 */

export interface FrontierEntry {
  url: string;
  depth: number;
}

export class Frontier {
  private queue: FrontierEntry[] = [];
  private visited = new Set<string>();
  private domainCounts = new Map<string, number>();
  private maxDepth: number;
  private maxPerDomain: number;

  constructor(maxDepth = 3, maxPerDomain = 20) {
    this.maxDepth = maxDepth;
    this.maxPerDomain = maxPerDomain;
  }

  /** Add a URL to the queue if not already visited and within limits. */
  add(url: string, depth: number): boolean {
    if (depth > this.maxDepth) return false;

    const normalized = this.normalize(url);
    if (!normalized) return false;
    if (this.visited.has(normalized)) return false;

    const domain = this.extractDomain(normalized);
    if (!domain) return false;

    const count = this.domainCounts.get(domain) ?? 0;
    if (count >= this.maxPerDomain) return false;

    this.visited.add(normalized);
    this.domainCounts.set(domain, count + 1);
    this.queue.push({ url: normalized, depth });
    return true;
  }

  /** Add multiple seed URLs at depth 0. */
  addSeeds(urls: string[]): void {
    for (const url of urls) {
      this.add(url, 0);
    }
  }

  /** Pop the next URL from the front of the queue. */
  next(): FrontierEntry | null {
    return this.queue.shift() ?? null;
  }

  /** Check if the queue is empty. */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /** Total number of visited URLs. */
  visitedCount(): number {
    return this.visited.size;
  }

  /** Check if a URL has been visited. */
  hasVisited(url: string): boolean {
    const normalized = this.normalize(url);
    return normalized ? this.visited.has(normalized) : true;
  }

  private normalize(url: string): string | null {
    try {
      const u = new URL(url);
      // Strip fragment, force lowercase host
      u.hash = "";
      // Remove trailing slash for consistency
      let path = u.pathname.replace(/\/+$/, "") || "/";
      u.pathname = path;
      return u.toString();
    } catch {
      return null;
    }
  }

  private extractDomain(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
}
