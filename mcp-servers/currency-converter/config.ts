import { MCPServiceConfig } from "../shared/types";

export const config: MCPServiceConfig = {
  name: "currency-converter",
  description: "Real-time currency conversion using exchange rate APIs",
  version: "1.0.0",
  pricePerCall: "20000", // $0.02 per call (20000 atomic USDC)
  type: "API",
  fundingModel: "NATIVE_X402", // Direct payments, no revenue split
  tools: [
    {
      name: "convert_currency",
      description: "Convert an amount from one currency to another",
      inputSchema: {
        type: "object",
        properties: {
          amount: {
            type: "number",
            description: "The amount to convert",
            minimum: 0,
          },
          from: {
            type: "string",
            description: "Source currency code (e.g., USD, EUR, GBP)",
            maxLength: 3,
          },
          to: {
            type: "string",
            description: "Target currency code (e.g., USD, EUR, GBP)",
            maxLength: 3,
          },
        },
        required: ["amount", "from", "to"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          amount: { type: "number" },
          from: { type: "string" },
          to: { type: "string" },
          result: { type: "number" },
          rate: { type: "number" },
          timestamp: { type: "string" },
        },
        required: ["success"],
      },
    },
    {
      name: "get_exchange_rates",
      description: "Get exchange rates for a base currency",
      inputSchema: {
        type: "object",
        properties: {
          base: {
            type: "string",
            description: "Base currency code (e.g., USD)",
            maxLength: 3,
            default: "USD",
          },
          targets: {
            type: "string",
            description: "Comma-separated target currencies (e.g., EUR,GBP,JPY). Leave empty for all.",
            maxLength: 100,
          },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          base: { type: "string" },
          rates: {
            type: "object",
            additionalProperties: { type: "number" },
          },
          timestamp: { type: "string" },
        },
        required: ["success"],
      },
    },
  ],
};

export const settings = {
  port: parseInt(process.env.PORT || "3013"),
  ownerAddress: process.env.OWNER_ADDRESS || "",
  serviceId: process.env.SERVICE_ID || "",
  mockPayments: process.env.MOCK_PAYMENTS === "true",

  // Exchange rate API provider: "exchangerate-api" or "mock"
  provider: (process.env.EXCHANGE_PROVIDER || "mock") as "exchangerate-api" | "mock",
  apiKey: process.env.EXCHANGE_API_KEY || "",
};

// x402 v2 configuration
export const x402Config = {
  network: "eip155:10143", // Monad testnet CAIP-2
  usdcAddress: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  gatewayAddress: "0x2B374335B3f3BBa301210a87dF6FB06a18125935",
  facilitatorUrl: "https://x402-facilitator.molandak.org",
};
