import axios from "axios";
import * as cheerio from "cheerio";
import { BaseScraper } from "../scrapers/base.js";
import { ScrapeJob } from "../types/job.js";
import { RawLead } from "../types/lead.js";
import { config } from "../config.js";
import { randomUserAgent } from "../anti-ban/user-agents.js";
import { randomDelay } from "../anti-ban/delays.js";
import { extractEmails, extractPhones } from "../extractors/contact.js";
import { detectTechStack, hasSSL } from "../extractors/tech-stack.js";
import { Frontier } from "./frontier.js";
import { sortByPriority } from "./link-filter.js";
import { log } from "../utils/logger.js";

const MAX_PAGES_PER_SITE = 15;
const MAX_DEPTH = 3;
const MAX_SITES = 50;

/**
 * Seed URLs for well-known business directories.
 * The crawler starts from these, follows links to find businesses.
 */
const SEED_URL_TEMPLATES: Record<string, string[]> = {
  clutch: [
    "https://clutch.co/directory?q={category}&location={city}",
  ],
  bbb: [
    "https://www.bbb.org/search?find_text={category}&find_loc={city}",
  ],
  chamberofcommerce: [
    "https://www.chamberofcommerce.com/search?q={category}&l={city}",
  ],
};

/**
 * Web Crawler scraper — BFS link follower that discovers businesses
 * from seed directories and extracts contact info.
 */
export class WebCrawlerScraper extends BaseScraper {
  readonly source = "web_crawler";

  async *scrape(
    job: ScrapeJob,
    signal: AbortSignal
  ): AsyncGenerator<RawLead[], void, unknown> {
    let batch: RawLead[] = [];
    const discoveredDomains = new Set<string>();

    // Generate seed URLs from templates
    const seedUrls = this.buildSeedUrls(job);

    // Phase 1: Crawl seed directories to discover business URLs
    const businessUrls = await this.discoverSitesFromSeeds(seedUrls, job, signal);

    // Phase 2: Crawl each discovered business site for contact info
    for (const siteUrl of businessUrls) {
      if (signal.aborted) break;

      const domain = this.extractDomain(siteUrl);
      if (!domain || discoveredDomains.has(domain)) continue;
      discoveredDomains.add(domain);

      if (discoveredDomains.size > MAX_SITES) break;

      const lead = await this.crawlSite(siteUrl, domain, job, signal);
      if (lead) {
        batch.push(lead);
        if (batch.length >= config.batchSize) {
          yield batch;
          batch = [];
        }
      }
    }

    if (batch.length > 0) {
      yield batch;
    }
  }

  /**
   * Build seed URLs from templates, substituting category and city.
   */
  private buildSeedUrls(job: ScrapeJob): string[] {
    const urls: string[] = [];
    for (const templates of Object.values(SEED_URL_TEMPLATES)) {
      for (const template of templates) {
        urls.push(
          template
            .replace("{category}", encodeURIComponent(job.category))
            .replace("{city}", encodeURIComponent(job.city))
        );
      }
    }
    return urls;
  }

  /**
   * Crawl seed directories to discover external business website URLs.
   */
  private async discoverSitesFromSeeds(
    seedUrls: string[],
    job: ScrapeJob,
    signal: AbortSignal
  ): Promise<string[]> {
    const discovered: string[] = [];
    const seenDomains = new Set<string>();

    for (const seedUrl of seedUrls) {
      if (signal.aborted || discovered.length >= MAX_SITES) break;

      try {
        const { data } = await axios.get<string>(seedUrl, {
          timeout: 15_000,
          headers: {
            "User-Agent": randomUserAgent(),
            "Accept": "text/html",
          },
          signal,
          responseType: "text",
        });

        const $ = cheerio.load(data);

        // Extract all external links that look like business websites
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href");
          if (!href) return;

          let fullUrl: string;
          try {
            fullUrl = new URL(href, seedUrl).toString();
          } catch {
            return;
          }

          const domain = this.extractDomain(fullUrl);
          if (!domain) return;

          // Skip seed site domains and common non-business sites
          const seedDomain = this.extractDomain(seedUrl);
          if (domain === seedDomain) return;
          if (this.isCommonSite(domain)) return;
          if (seenDomains.has(domain)) return;

          seenDomains.add(domain);
          discovered.push(fullUrl);
        });

        await randomDelay();
      } catch (err) {
        if (signal.aborted) break;
        log.error("seed crawl failed", { url: seedUrl, error: String(err) });
      }
    }

    return discovered;
  }

  /**
   * BFS crawl a single business site to extract contact info.
   * Follows links on the site (prioritizing /contact, /about, /team).
   */
  private async crawlSite(
    startUrl: string,
    domain: string,
    job: ScrapeJob,
    signal: AbortSignal
  ): Promise<RawLead | null> {
    const frontier = new Frontier(MAX_DEPTH, MAX_PAGES_PER_SITE);
    frontier.add(startUrl, 0);

    let businessName: string | null = null;
    const allEmails = new Set<string>();
    const allPhones = new Set<string>();
    let pagesCrawled = 0;

    while (!frontier.isEmpty() && !signal.aborted && pagesCrawled < MAX_PAGES_PER_SITE) {
      const entry = frontier.next();
      if (!entry) break;

      try {
        const { data } = await axios.get<string>(entry.url, {
          timeout: 10_000,
          headers: { "User-Agent": randomUserAgent() },
          signal,
          maxRedirects: 3,
          responseType: "text",
        });

        pagesCrawled++;

        const $ = cheerio.load(data);
        const text = $.text();

        // Extract contacts from this page
        for (const email of extractEmails(text)) allEmails.add(email);
        for (const phone of extractPhones(text)) allPhones.add(phone);

        // Get business name from first page (homepage)
        if (!businessName) {
          businessName =
            $("title").text().trim()
            || $('meta[property="og:site_name"]').attr("content")?.trim()
            || domain;
        }

        // Discover links on this page and add to frontier
        const discoveredLinks: string[] = [];
        $("a[href]").each((_, el) => {
          const href = $(el).attr("href");
          if (!href) return;
          try {
            discoveredLinks.push(new URL(href, entry.url).toString());
          } catch { /* invalid URL */ }
        });

        const sorted = sortByPriority(discoveredLinks, domain);
        for (const link of sorted) {
          frontier.add(link, entry.depth + 1);
        }

        await randomDelay();
      } catch {
        // page fetch failed — continue with other pages
      }
    }

    // Only return a lead if we found at least some contact info
    if (allEmails.size === 0 && allPhones.size === 0) return null;

    const techStack = await detectTechStack(startUrl, signal).catch(() => null);

    return {
      business_name: businessName || domain,
      phone: [...allPhones][0] ?? null,
      email: [...allEmails][0] ?? null,
      website_url: startUrl,
      address: null,
      city: job.city,
      country: "US",
      category: job.category,
      source: this.source,
      tech_stack: techStack,
      has_ssl: hasSSL(startUrl),
      is_mobile_friendly: null,
    };
  }

  private extractDomain(url: string): string | null {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  }

  private isCommonSite(domain: string): boolean {
    const common = [
      "google.com", "facebook.com", "twitter.com", "x.com",
      "instagram.com", "linkedin.com", "youtube.com", "yelp.com",
      "yellowpages.com", "bbb.org", "clutch.co", "g2.com",
      "apple.com", "microsoft.com", "amazon.com", "wikipedia.org",
      "pinterest.com", "tiktok.com", "reddit.com",
    ];
    return common.some((c) => domain === c || domain.endsWith(`.${c}`));
  }
}
