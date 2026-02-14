import dotenv from "dotenv";
import path from "path";

// Load .env BEFORE importing modules that depend on env vars
dotenv.config({ path: path.join(__dirname, ".env") });

// Use require() for modules that depend on env vars at load time
const { MCPServer } = require("../shared/mcp-server");
const { config, settings } = require("./config");
const { extractMetadata } = require("./tools/extract-metadata");

// Validate configuration
if (!settings.ownerAddress) {
  console.error("ERROR: OWNER_ADDRESS environment variable is required");
  console.error("This is the address that will receive payments.");
  process.exit(1);
}

// Create MCP server with optional on-chain serviceId for dynamic payTo resolution
const server = new MCPServer(config, settings.ownerAddress, settings.serviceId || undefined);

// Register tool handlers
server.registerTool("extract_metadata", extractMetadata);

// Start server
server.start(settings.port);

console.log(`
===========================================
  URL Metadata Extractor MCP Service
===========================================
  Funding Model: NATIVE_X402 (Direct payments)
  Price: $${parseInt(config.pricePerCall) / 1_000_000} USDC per call
  Owner: ${settings.ownerAddress}

  Tools:
    - extract_metadata

  Endpoints:
    POST /mcp                    - MCP JSON-RPC
    POST /tools/extract_metadata - REST API
    GET  /health                 - Health check
    GET  /info                   - Service info
===========================================
`);
