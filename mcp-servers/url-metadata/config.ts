import { MCPServiceConfig } from "../shared/types";

export const config: MCPServiceConfig = {
  name: "url-metadata",
  description: "Extract metadata, OG tags, and content from URLs",
  version: "1.0.0",
  pricePerCall: "20000", // $0.02 per call (20000 atomic USDC)
  type: "API",
  fundingModel: "NATIVE_X402", // Direct payments, no revenue split
  tools: [
    {
      name: "extract_metadata",
      description: "Extract Open Graph tags, meta tags, and page info from a URL",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to extract metadata from",
            maxLength: 2048,
          },
          includeContent: {
            type: "boolean",
            description: "Include a text excerpt from the page",
            default: false,
          },
        },
        required: ["url"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          url: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          image: { type: "string" },
          siteName: { type: "string" },
          type: { type: "string" },
          locale: { type: "string" },
          canonical: { type: "string" },
          favicon: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          author: { type: "string" },
          publishedTime: { type: "string" },
          content: { type: "string" },
        },
        required: ["success"],
      },
    },
  ],
};

export const settings = {
  port: parseInt(process.env.PORT || "3014"),
  ownerAddress: process.env.OWNER_ADDRESS || "",
  serviceId: process.env.SERVICE_ID || "",
  mockPayments: process.env.MOCK_PAYMENTS === "true",
};

// x402 v2 configuration
export const x402Config = {
  network: "eip155:10143", // Monad testnet CAIP-2
  usdcAddress: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  gatewayAddress: "0x2B374335B3f3BBa301210a87dF6FB06a18125935",
  facilitatorUrl: "https://x402-facilitator.molandak.org",
};
