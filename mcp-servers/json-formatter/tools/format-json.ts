import { MCPContent } from "../../shared/types";
import { validateInput, applyDefaults } from "../../shared/schema-validator";
import { config } from "../config";

interface FormatJSONArgs {
  json: string;
  action?: "format" | "minify" | "validate";
  indent?: number;
  sortKeys?: boolean;
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export async function formatJSON(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[0].inputSchema;

  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  const input = applyDefaults(args, schema) as unknown as FormatJSONArgs;
  const originalSize = input.json.length;

  try {
    // Parse the JSON first to validate it
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.json);
    } catch (parseError) {
      const message =
        parseError instanceof Error ? parseError.message : "Invalid JSON";
      return [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            valid: false,
            error: message,
            originalSize: originalSize,
          }),
        },
      ];
    }

    // If validation only, return early
    if (input.action === "validate") {
      return [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            valid: true,
            originalSize: originalSize,
          }),
        },
      ];
    }

    // Sort keys if requested
    if (input.sortKeys) {
      parsed = sortObjectKeys(parsed);
    }

    // Format or minify
    let result: string;
    if (input.action === "minify") {
      result = JSON.stringify(parsed);
    } else {
      result = JSON.stringify(parsed, null, input.indent || 2);
    }

    return [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          valid: true,
          result: result,
          originalSize: originalSize,
          resultSize: result.length,
        }),
      },
    ];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process JSON";
    return [
      {
        type: "text",
        text: JSON.stringify({
          success: false,
          error: message,
          originalSize: originalSize,
        }),
      },
    ];
  }
}
