import "dotenv/config";
import { MCPServer } from "../shared/mcp-server";
import { config, settings } from "./config";
import { generateHash } from "./tools/generate-hash";

// Validate configuration
if (!settings.ownerAddress) {
  console.error("ERROR: OWNER_ADDRESS environment variable is required");
  console.error("This is the address that will receive payments.");
  process.exit(1);
}

// Create MCP server
const server = new MCPServer(config, settings.ownerAddress);

// Register tool handlers
server.registerTool("generate_hash", generateHash);

// Start server
server.start(settings.port);

console.log(`
===========================================
  Hash Generator MCP Service
===========================================
  Price: $${parseInt(config.pricePerCall) / 1_000_000} USDC per call
  Owner: ${settings.ownerAddress}

  Tools:
    - generate_hash (md5, sha1, sha256, sha384, sha512)

  Endpoints:
    POST /mcp                - MCP JSON-RPC
    POST /tools/generate_hash - REST API
    GET  /health             - Health check
    GET  /info               - Service info
===========================================
`);
