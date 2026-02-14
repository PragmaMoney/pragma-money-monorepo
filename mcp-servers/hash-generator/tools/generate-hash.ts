import crypto from "crypto";
import { MCPContent } from "../../shared/types";
import { validateInput, applyDefaults } from "../../shared/schema-validator";
import { config } from "../config";

interface GenerateHashArgs {
  data: string;
  algorithm?: "md5" | "sha1" | "sha256" | "sha384" | "sha512";
  encoding?: "hex" | "base64";
}

export async function generateHash(
  args: Record<string, unknown>
): Promise<MCPContent[]> {
  const schema = config.tools[0].inputSchema;

  const { valid, errors } = validateInput(args, schema);
  if (!valid) {
    throw new Error(`Invalid input: ${errors.join(", ")}`);
  }

  const input = applyDefaults(args, schema) as GenerateHashArgs;

  try {
    const algorithm = input.algorithm || "sha256";
    const encoding = input.encoding || "hex";

    const hash = crypto
      .createHash(algorithm)
      .update(input.data)
      .digest(encoding as crypto.BinaryToTextEncoding);

    return [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          hash: hash,
          algorithm: algorithm,
          encoding: encoding,
          inputLength: input.data.length,
        }),
      },
    ];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to generate hash";
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
