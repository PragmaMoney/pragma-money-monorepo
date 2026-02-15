import { MCPServiceConfig } from "../../shared/types";

/**
 * Native x402 MCP Service Configuration
 *
 * This template is for self-funded agents using the NATIVE_X402 funding model:
 * - Direct payments to your wallet (EOA or SmartAccount)
 * - No revenue split with investor pool
 * - No proxy wrapping required
 *
 * Update these values for your specific service.
 */

// x402 v2 Configuration Constants
export const x402Config = {
  // x402 protocol version
  version: 2,

  // Network in CAIP-2 format (eip155:<chainId>)
  // Monad Testnet chain ID: 10143
  network: "eip155:10143" as const,

  // Default facilitator URL for payment facilitation
  facilitatorUrl: process.env.FACILITATOR_URL || "https://facilitator.pragma.money",

  // USDC token address on Monad Testnet
  asset: process.env.USDC_ADDRESS || "0x534b2f3A21130d7a60830c2Df862319e593943A3",

  // x402 Gateway contract address
  gatewayContract: process.env.GATEWAY_ADDRESS || "0x76f3a9aE46D58761f073a8686Eb60194B1917E27",

  // Default payment timeout in seconds
  maxTimeoutSeconds: 300,
};

export const config: MCPServiceConfig = {
  name: "my-native-x402-service",
  description: "A self-funded MCP service with native x402 payments",
  version: "1.0.0",
  pricePerCall: "1000", // $0.001 per call (1000 atomic USDC, 6 decimals)
  type: "API",
  fundingModel: "NATIVE_X402", // Direct payments, no revenue split
  tools: [
    {
      name: "example_tool",
      description: "An example tool that echoes input",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to echo back",
            maxLength: 500,
          },
        },
        required: ["message"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          echo: { type: "string" },
          timestamp: { type: "string" },
        },
        required: ["success"],
      },
    },
    {
      name: "pyth_price",
      description: "Get real-time cryptocurrency prices from Pyth Network",
      inputSchema: {
        type: "object",
        properties: {
          asset: {
            type: "string",
            description: "Asset symbol (ETH, BTC, SOL)",
            enum: ["ETH", "BTC", "SOL"],
          },
          priceId: {
            type: "string",
            description: "Pyth price feed ID (optional, overrides asset)",
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          asset: { type: "string" },
          price: { type: "string" },
          confidence: { type: "string" },
          publishTime: { type: "string" },
        },
      },
    },
  ],
};

export const settings = {
  port: parseInt(process.env.PORT || "3003"),

  // Payment recipient - can be EOA or SmartAccount address
  // For NATIVE_X402, payments go directly here (no split)
  // Note: If SERVICE_ID is set, payTo is resolved from on-chain ServiceRegistry
  ownerAddress: process.env.OWNER_ADDRESS || "",

  // On-chain serviceId (bytes32) - set after registering on-chain
  // When set, the server dynamically resolves payTo from ServiceRegistry
  serviceId: process.env.SERVICE_ID || "",

  // Optional: Enable mock mode for testing without on-chain verification
  mockPayments: process.env.MOCK_PAYMENTS === "true",
};
