import { MCPServiceConfig } from "../shared/types";

export const config: MCPServiceConfig = {
  name: "markdown-to-html",
  description: "Convert Markdown text to HTML with syntax highlighting support",
  version: "1.0.0",
  pricePerCall: "10000", // $0.01 per call (10000 atomic USDC)
  type: "API",
  tools: [
    {
      name: "convert_markdown",
      description: "Convert Markdown text to HTML",
      inputSchema: {
        type: "object",
        properties: {
          markdown: {
            type: "string",
            description: "The Markdown text to convert",
            maxLength: 100000,
          },
          options: {
            type: "object",
            description: "Conversion options",
            properties: {
              gfm: {
                type: "boolean",
                description: "Enable GitHub Flavored Markdown",
                default: true,
              },
              breaks: {
                type: "boolean",
                description: "Convert line breaks to <br>",
                default: false,
              },
              sanitize: {
                type: "boolean",
                description: "Sanitize HTML output",
                default: true,
              },
              headerIds: {
                type: "boolean",
                description: "Add IDs to headers",
                default: true,
              },
            },
          },
        },
        required: ["markdown"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          html: { type: "string" },
          markdownLength: { type: "number" },
          htmlLength: { type: "number" },
        },
        required: ["success"],
      },
    },
  ],
};

export const settings = {
  port: parseInt(process.env.PORT || "3015"),
  ownerAddress: process.env.OWNER_ADDRESS || "",
};
