import dotenv from "dotenv";
import path from "path";

// Load .env BEFORE importing modules that depend on env vars
dotenv.config({ path: path.join(__dirname, ".env") });

// Use require() for modules that depend on env vars at load time
// ES imports are hoisted, so they run before dotenv.config()
const { MCPServer } = require("../../shared/mcp-server");
const { config, settings, x402Config } = require("./config");
const { exampleTool } = require("./tools/example-tool");
const { pythPrice } = require("./tools/pyth-price");

/**
 * Native x402 MCP Server Template
 *
 * This template demonstrates how to create a self-funded MCP service
 * using the NATIVE_X402 funding model. Payments go directly to your
 * wallet without revenue splitting.
 *
 * Getting started:
 * 1. Copy this template to a new directory
 * 2. Update config.ts with your service details
 * 3. Implement your tool handlers in tools/
 * 4. Set OWNER_ADDRESS in .env to your wallet address
 * 5. Register your service on-chain with --funding-model NATIVE_X402
 */

// Validate configuration
if (!settings.ownerAddress) {
  console.error("ERROR: OWNER_ADDRESS environment variable is required");
  console.error("This is the address that will receive payments.");
  console.error("For NATIVE_X402, this can be an EOA or SmartAccount.");
  process.exit(1);
}

// Create MCP server with optional on-chain serviceId for dynamic payTo resolution
const server = new MCPServer(config, settings.ownerAddress, settings.serviceId || undefined);

// Register tool handlers
server.registerTool("example_tool", exampleTool);
server.registerTool("pyth_price", pythPrice);

// Start server
server.start(settings.port);

console.log(`
===========================================
  Native x402 MCP Service (v2)
===========================================
  x402 Version: ${x402Config.version}
  Network: ${x402Config.network} (CAIP-2)
  Funding Model: NATIVE_X402 (Direct payments)
  Price: $${parseInt(config.pricePerCall) / 1_000_000} USDC per call
  Owner: ${settings.ownerAddress}
  Gateway: ${x402Config.gatewayContract}
  Facilitator: ${x402Config.facilitatorUrl}
  Mock Payments: ${settings.mockPayments ? "enabled" : "disabled"}

  Tools:
    - example_tool
    - pyth_price

  Endpoints:
    POST /mcp                 - MCP JSON-RPC
    POST /tools/example_tool  - REST API
    GET  /health              - Health check
    GET  /info                - Service info

  Registration:
    pragma-agent services register \\
      --name "${config.name}" \\
      --price ${parseInt(config.pricePerCall) / 1_000_000} \\
      --endpoint "http://localhost:${settings.port}/mcp" \\
      --type API \\
      --funding-model NATIVE_X402
===========================================
`);
