import "dotenv/config";
import { MCPServer } from "../shared/mcp-server";
import { config, settings } from "./config";
import { getCurrentWeather } from "./tools/get-current";
import { getForecast } from "./tools/get-forecast";

// Validate configuration
if (!settings.ownerAddress) {
  console.error("ERROR: OWNER_ADDRESS environment variable is required");
  console.error("This is the address that will receive payments.");
  process.exit(1);
}

if (settings.provider === "openweathermap" && !settings.weatherApiKey) {
  console.warn("WARNING: WEATHER_API_KEY not set, using mock data");
}

// Create MCP server
const server = new MCPServer(config, settings.ownerAddress);

// Register tool handlers
server.registerTool("get_current_weather", getCurrentWeather);
server.registerTool("get_forecast", getForecast);

// Start server
server.start(settings.port);

console.log(`
===========================================
  Weather API MCP Service
===========================================
  Provider: ${settings.provider}
  Price: $${parseInt(config.pricePerCall) / 1_000_000} USDC per call
  Owner: ${settings.ownerAddress}

  Tools:
    - get_current_weather
    - get_forecast

  Endpoints:
    POST /mcp                    - MCP JSON-RPC
    POST /tools/get_current_weather - REST API
    POST /tools/get_forecast        - REST API
    GET  /health                 - Health check
    GET  /info                   - Service info
===========================================
`);
