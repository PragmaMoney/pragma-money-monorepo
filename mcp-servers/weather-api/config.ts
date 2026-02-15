import { MCPServiceConfig } from "../shared/types";

export const config: MCPServiceConfig = {
  name: "weather-api",
  description: "Get current weather and forecasts for any location worldwide",
  version: "1.0.0",
  pricePerCall: "100", // $0.0001 per call (100 atomic USDC)
  type: "API",
  tools: [
    {
      name: "get_current_weather",
      description: "Get the current weather conditions for a specific location",
      inputSchema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City name (e.g., 'London') or coordinates (e.g., '51.5,-0.1')",
            maxLength: 100,
          },
          units: {
            type: "string",
            description: "Temperature units",
            enum: ["metric", "imperial"],
            default: "metric",
          },
        },
        required: ["location"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          location: { type: "string" },
          temperature: { type: "number" },
          feels_like: { type: "number" },
          unit: { type: "string" },
          conditions: { type: "string" },
          humidity: { type: "number" },
          wind_speed: { type: "number" },
          timestamp: { type: "string" },
        },
        required: ["success"],
      },
    },
    {
      name: "get_forecast",
      description: "Get a 5-day weather forecast for a location",
      inputSchema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City name or coordinates",
            maxLength: 100,
          },
          units: {
            type: "string",
            enum: ["metric", "imperial"],
            default: "metric",
          },
          days: {
            type: "number",
            description: "Number of days to forecast (1-5)",
            minimum: 1,
            maximum: 5,
            default: 5,
          },
        },
        required: ["location"],
      },
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          location: { type: "string" },
          forecast: {
            type: "array",
            items: {
              type: "object",
              properties: {
                date: { type: "string" },
                high: { type: "number" },
                low: { type: "number" },
                conditions: { type: "string" },
                precipitation_chance: { type: "number" },
              },
            },
          },
        },
        required: ["success"],
      },
    },
  ],
};

export const settings = {
  port: parseInt(process.env.PORT || "3002"),
  ownerAddress: process.env.OWNER_ADDRESS || "",

  // Weather provider: "openweathermap" or "mock"
  provider: (process.env.WEATHER_PROVIDER || "mock") as "openweathermap" | "mock",

  // API Key
  weatherApiKey: process.env.WEATHER_API_KEY || "",
};

// x402 v2 configuration
export const x402Config = {
  network: "eip155:10143", // Monad testnet CAIP-2
  usdcAddress: "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  gatewayAddress: "0x76f3a9aE46D58761f073a8686Eb60194B1917E27",
  facilitatorUrl: "https://x402-facilitator.molandak.org",
};
