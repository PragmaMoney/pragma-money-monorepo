import "dotenv/config";
import { MCPServer } from "../shared/mcp-server";
import { config, settings } from "./config";
import { formatJSON } from "./tools/format-json";

// Validate configuration
if (!settings.ownerAddress) {
  console.error("ERROR: OWNER_ADDRESS environment variable is required");
  console.error("This is the address that will receive payments.");
  process.exit(1);
}

// Create MCP server
const server = new MCPServer(config, settings.ownerAddress);

// Register tool handlers
server.registerTool("format_json", formatJSON);

// Start server
server.start(settings.port);

console.log(`
===========================================
  JSON Formatter MCP Service
===========================================
  Price: $${parseInt(config.pricePerCall) / 1_000_000} USDC per call
  Owner: ${settings.ownerAddress}

  Tools:
    - format_json (format, minify, validate)

  Endpoints:
    POST /mcp               - MCP JSON-RPC
    POST /tools/format_json - REST API
    GET  /health            - Health check
    GET  /info              - Service info
===========================================
`);
