import axios from "axios";
import { randomUserAgent } from "../anti-ban/user-agents.js";

/**
 * Lightweight tech stack detection by checking page headers + HTML markers.
 * No Wappalyzer dependency — simple pattern matching for common CMS/frameworks.
 */
export async function detectTechStack(
  url: string,
  signal?: AbortSignal
): Promise<Record<string, string> | null> {
  try {
    const { data, headers } = await axios.get<string>(url, {
      timeout: 10_000,
      headers: { "User-Agent": randomUserAgent() },
      signal,
      maxRedirects: 3,
      responseType: "text",
    });

    const tech: Record<string, string> = {};
    const html = typeof data === "string" ? data.toLowerCase() : "";

    // CMS detection
    if (html.includes("wp-content") || html.includes("wordpress")) {
      tech.cms = "wordpress";
    } else if (html.includes("sites/default/files") || html.includes("drupal")) {
      tech.cms = "drupal";
    } else if (html.includes("joomla")) {
      tech.cms = "joomla";
    } else if (html.includes("shopify")) {
      tech.cms = "shopify";
    } else if (html.includes("squarespace")) {
      tech.cms = "squarespace";
    } else if (html.includes("wix.com")) {
      tech.cms = "wix";
    } else if (html.includes("webflow")) {
      tech.cms = "webflow";
    }

    // Framework detection
    if (html.includes("__next") || html.includes("next.js")) {
      tech.framework = "nextjs";
    } else if (html.includes("__nuxt")) {
      tech.framework = "nuxt";
    } else if (html.includes("ng-version") || html.includes("angular")) {
      tech.framework = "angular";
    } else if (html.includes("reactroot") || html.includes("__react")) {
      tech.framework = "react";
    }

    // Server from headers
    const server = headers["x-powered-by"] || headers["server"];
    if (server) {
      tech.server = String(server).toLowerCase();
    }

    return Object.keys(tech).length > 0 ? tech : null;
  } catch {
    return null;
  }
}

/** Check if a URL has SSL by probing the HTTPS version. */
export async function hasSSL(url: string): Promise<boolean> {
  if (url.startsWith("https://")) return true;

  // If the URL is http://, try the https:// equivalent
  const httpsUrl = url.replace(/^http:\/\//, "https://");
  try {
    await axios.head(httpsUrl, {
      timeout: 5_000,
      headers: { "User-Agent": randomUserAgent() },
      maxRedirects: 3,
    });
    return true;
  } catch {
    return false;
  }
}
