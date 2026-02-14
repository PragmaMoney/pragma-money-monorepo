import { marked } from "marked";
import { MCPContent } from "../../shared/types";
import { validateInput, applyDefaults } from "../../shared/schema-validator";
import { config } from "../config";

interface ConvertArgs {
  markdown: string;
  options?: {
    gfm?: boolean;
    breaks?: boolean;
    sanitize?: boolean;
    headerIds?: boolean;
  };
}

// Simple HTML sanitizer (removes script tags and event handlers)
function sanitizeHtml(html: string): string {
  return html
    // Remove script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    // Remove event handlers
    .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, "")
    // Remove javascript: URLs
    .replace(/javascript:/gi, "");
}

export async function convertMarkdown(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[0].inputSchema;

  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  const input = applyDefaults(args, schema) as ConvertArgs;
  const options = input.options || {};

  try {
    // Configure marked options
    marked.setOptions({
      gfm: options.gfm !== false,
      breaks: options.breaks === true,
    });

    // Convert markdown to HTML
    let html = marked.parse(input.markdown) as string;

    // Sanitize if requested (default: true)
    if (options.sanitize !== false) {
      html = sanitizeHtml(html);
    }

    // Add header IDs if requested (default: true)
    if (options.headerIds !== false) {
      html = html.replace(/<h([1-6])>([^<]+)<\/h[1-6]>/g, (_, level, text) => {
        const id = text
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        return `<h${level} id="${id}">${text}</h${level}>`;
      });
    }

    return [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          html: html,
          markdownLength: input.markdown.length,
          htmlLength: html.length,
        }),
      },
    ];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to convert markdown";
    return [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: message,
        }),
      },
    ];
  }
}
