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

// x402 v2 configuration
export const x402Config = {
  network: "eip155:10143", // Monad testnet CAIP-2
  usdcAddress: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  gatewayAddress: "0x76f3a9aE46D58761f073a8686Eb60194B1917E27",
  facilitatorUrl: "https://x402-facilitator.molandak.org",
};
