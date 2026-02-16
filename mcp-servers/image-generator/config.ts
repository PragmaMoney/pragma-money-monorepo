import { MCPServiceConfig } from "../shared/types";

export const config: MCPServiceConfig = {
  name: "image-generator",
  description: "Generate images from text prompts using AI models",
  version: "1.0.0",
  pricePerCall: "50000", // $0.05 per image (50000 atomic USDC)
  type: "COMPUTE",
  tools: [
    {
      name: "generate_image",
      description:
        "Generate an image from a text prompt. Supports different sizes and styles.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Text description of the image to generate",
            maxLength: 1000,
          },
          size: {
            type: "string",
            description: "Image dimensions",
            enum: ["1024x1024", "1024x1792", "1792x1024"],
            default: "1024x1024",
          },
          style: {
            type: "string",
            description: "Visual style of the generated image",
            enum: ["realistic", "artistic", "cartoon", "3d-render"],
            default: "realistic",
          },
        },
        required: ["prompt"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          image_url: { type: "string", format: "uri" },
          prompt_used: { type: "string" },
          generation_time_ms: { type: "number" },
          size: { type: "string" },
          style: { type: "string" },
        },
        required: ["success"],
      },
    },
  ],
};

// Environment-based settings
export const settings = {
  port: parseInt(process.env.PORT || "3001"),
  ownerAddress: process.env.OWNER_ADDRESS || "",

  // AI Provider (choose one)
  provider: (process.env.AI_PROVIDER || "replicate") as "openai" | "replicate" | "mock",

  // API Keys
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  replicateApiKey: process.env.REPLICATE_API_KEY || "",
};

// x402 v2 configuration
export const x402Config = {
  network: "eip155:10143", // Monad testnet CAIP-2
  usdcAddress: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  gatewayAddress: "0x2B374335B3f3BBa301210a87dF6FB06a18125935",
  facilitatorUrl: "https://x402-facilitator.molandak.org",
};
