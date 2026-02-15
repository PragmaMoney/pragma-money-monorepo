import { MCPContent } from "../../shared/types";
import { validateInput, applyDefaults } from "../../shared/schema-validator";
import { config } from "../config";

interface ExtractArgs {
  url: string;
  includeContent?: boolean;
}

interface Metadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
  locale?: string;
  canonical?: string;
  favicon?: string;
  keywords?: string[];
  author?: string;
  publishedTime?: string;
  content?: string;
}

// Extract value from meta tag
function extractMetaContent(html: string, property: string): string | undefined {
  // Try property attribute (og:, twitter:)
  let match = html.match(
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']*)["']`, "i")
  );
  if (match) return match[1];

  // Try name attribute
  match = html.match(
    new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']*)["']`, "i")
  );
  if (match) return match[1];

  // Try reverse order (content before property/name)
  match = html.match(
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${property}["']`, "i")
  );
  if (match) return match[1];

  match = html.match(
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${property}["']`, "i")
  );
  if (match) return match[1];

  return undefined;
}

// Extract title from <title> tag
function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : undefined;
}

// Extract favicon
function extractFavicon(html: string, baseUrl: string): string | undefined {
  const match = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']*)["']/i);
  if (match) {
    const href = match[1];
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return `https:${href}`;
    if (href.startsWith("/")) {
      const url = new URL(baseUrl);
      return `${url.origin}${href}`;
    }
    return `${baseUrl}/${href}`;
  }

  // Default favicon location
  const url = new URL(baseUrl);
  return `${url.origin}/favicon.ico`;
}

// Extract text content (simple extraction)
function extractContent(html: string, maxLength: number = 500): string {
  // Remove script, style, and other non-content tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + "...";
  }

  return text;
}

export async function extractMetadata(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[0].inputSchema;

  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  const input = applyDefaults(args, schema) as unknown as ExtractArgs;

  try {
    // Validate URL format
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new Error("Invalid URL format");
    }

    // Fetch the page
    const response = await fetch(input.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; URLMetadataBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Extract metadata
    const metadata: Metadata = {
      url: response.url || input.url,
      title: extractMetaContent(html, "og:title") || extractTitle(html),
      description:
        extractMetaContent(html, "og:description") ||
        extractMetaContent(html, "description"),
      image: extractMetaContent(html, "og:image"),
      siteName: extractMetaContent(html, "og:site_name"),
      type: extractMetaContent(html, "og:type"),
      locale: extractMetaContent(html, "og:locale"),
      canonical:
        extractMetaContent(html, "og:url") ||
        html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i)?.[1],
      favicon: extractFavicon(html, input.url),
      author: extractMetaContent(html, "author"),
      publishedTime:
        extractMetaContent(html, "article:published_time") ||
        extractMetaContent(html, "datePublished"),
    };

    // Extract keywords
    const keywordsStr = extractMetaContent(html, "keywords");
    if (keywordsStr) {
      metadata.keywords = keywordsStr.split(",").map((k) => k.trim());
    }

    // Extract content if requested
    if (input.includeContent) {
      metadata.content = extractContent(html);
    }

    return [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          ...metadata,
        }),
      },
    ];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extract metadata";
    return [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: message,
          url: input.url,
        }),
      },
    ];
  }
}
