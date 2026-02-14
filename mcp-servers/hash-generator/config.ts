import { MCPServiceConfig } from "../shared/types";

export const config: MCPServiceConfig = {
  name: "hash-generator",
  description: "Generate cryptographic hashes (MD5, SHA256, SHA512) from text or data",
  version: "1.0.0",
  pricePerCall: "10000", // $0.01 per call (10000 atomic USDC)
  type: "API",
  tools: [
    {
      name: "generate_hash",
      description: "Generate a cryptographic hash from input text",
      inputSchema: {
        type: "object",
        properties: {
          data: {
            type: "string",
            description: "The text or data to hash",
            maxLength: 100000,
          },
          algorithm: {
            type: "string",
            description: "Hash algorithm to use",
            enum: ["md5", "sha1", "sha256", "sha384", "sha512"],
            default: "sha256",
          },
          encoding: {
            type: "string",
            description: "Output encoding",
            enum: ["hex", "base64"],
            default: "hex",
          },
        },
        required: ["data"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          hash: { type: "string" },
          algorithm: { type: "string" },
          encoding: { type: "string" },
          inputLength: { type: "number" },
        },
        required: ["success"],
      },
    },
  ],
};

export const settings = {
  port: parseInt(process.env.PORT || "3011"),
  ownerAddress: process.env.OWNER_ADDRESS || "",
};
