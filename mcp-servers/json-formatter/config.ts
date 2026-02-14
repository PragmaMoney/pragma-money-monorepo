import { MCPServiceConfig } from "../shared/types";

export const config: MCPServiceConfig = {
  name: "json-formatter",
  description: "Validate, format, minify, and transform JSON data",
  version: "1.0.0",
  pricePerCall: "10000", // $0.01 per call (10000 atomic USDC)
  type: "API",
  tools: [
    {
      name: "format_json",
      description: "Format, validate, or minify JSON data",
      inputSchema: {
        type: "object",
        properties: {
          json: {
            type: "string",
            description: "The JSON string to process",
            maxLength: 500000,
          },
          action: {
            type: "string",
            description: "Action to perform on the JSON",
            enum: ["format", "minify", "validate"],
            default: "format",
          },
          indent: {
            type: "number",
            description: "Number of spaces for indentation (when formatting)",
            minimum: 0,
            maximum: 8,
            default: 2,
          },
          sortKeys: {
            type: "boolean",
            description: "Sort object keys alphabetically",
            default: false,
          },
        },
        required: ["json"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          valid: { type: "boolean" },
          result: { type: "string" },
          originalSize: { type: "number" },
          resultSize: { type: "number" },
          error: { type: "string" },
        },
        required: ["success"],
      },
    },
  ],
};

export const settings = {
  port: parseInt(process.env.PORT || "3012"),
  ownerAddress: process.env.OWNER_ADDRESS || "",
};
