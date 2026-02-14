import dotenv from "dotenv";
import path from "path";

// Load .env BEFORE importing modules that depend on env vars
dotenv.config({ path: path.join(__dirname, ".env") });

// Use require() for modules that depend on env vars at load time
const { MCPServer } = require("../shared/mcp-server");
const { config, settings } = require("./config");
const { convertCurrency, getExchangeRates } = require("./tools/convert-currency");

// Validate configuration
if (!settings.ownerAddress) {
  console.error("ERROR: OWNER_ADDRESS environment variable is required");
  console.error("This is the address that will receive payments.");
  process.exit(1);
}

if (settings.provider === "exchangerate-api" && !settings.apiKey) {
  console.warn("WARNING: EXCHANGE_API_KEY not set, using mock rates");
}

// Create MCP server with optional on-chain serviceId for dynamic payTo resolution
const server = new MCPServer(config, settings.ownerAddress, settings.serviceId || undefined);

// Register tool handlers
server.registerTool("convert_currency", convertCurrency);
server.registerTool("get_exchange_rates", getExchangeRates);

// Start server
server.start(settings.port);

console.log(`
===========================================
  Currency Converter MCP Service
===========================================
  Funding Model: NATIVE_X402 (Direct payments)
  Provider: ${settings.provider}
  Price: $${parseInt(config.pricePerCall) / 1_000_000} USDC per call
  Owner: ${settings.ownerAddress}

  Tools:
    - convert_currency
    - get_exchange_rates

  Endpoints:
    POST /mcp                    - MCP JSON-RPC
    POST /tools/convert_currency - REST API
    POST /tools/get_exchange_rates - REST API
    GET  /health                 - Health check
    GET  /info                   - Service info
===========================================
`);
