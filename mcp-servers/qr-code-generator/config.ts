import { MCPServiceConfig } from "../shared/types";

export const config: MCPServiceConfig = {
  name: "qr-code-generator",
  description: "Generate QR codes from text, URLs, or any data",
  version: "1.0.0",
  pricePerCall: "10000", // $0.01 per call (10000 atomic USDC)
  type: "API",
  tools: [
    {
      name: "generate_qr",
      description: "Generate a QR code from text or URL",
      inputSchema: {
        type: "object",
        properties: {
          data: {
            type: "string",
            description: "The text or URL to encode in the QR code",
            maxLength: 2048,
          },
          size: {
            type: "number",
            description: "Size of the QR code in pixels (100-1000)",
            minimum: 100,
            maximum: 1000,
            default: 300,
          },
          format: {
            type: "string",
            description: "Output format",
            enum: ["png", "svg", "base64"],
            default: "base64",
          },
          errorCorrection: {
            type: "string",
            description: "Error correction level (L=7%, M=15%, Q=25%, H=30%)",
            enum: ["L", "M", "Q", "H"],
            default: "M",
          },
        },
        required: ["data"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          data: { type: "string" },
          format: { type: "string" },
          size: { type: "number" },
          qrData: { type: "string" },
        },
        required: ["success"],
      },
    },
  ],
};

export const settings = {
  port: parseInt(process.env.PORT || "3010"),
  ownerAddress: process.env.OWNER_ADDRESS || "",
};
