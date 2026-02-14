import "dotenv/config";
import { MCPServer } from "../shared/mcp-server";
import { config, settings } from "./config";
import { convertMarkdown } from "./tools/convert-md";

// Validate configuration
if (!settings.ownerAddress) {
  console.error("ERROR: OWNER_ADDRESS environment variable is required");
  console.error("This is the address that will receive payments.");
  process.exit(1);
}

// Create MCP server
const server = new MCPServer(config, settings.ownerAddress);

// Register tool handlers
server.registerTool("convert_markdown", convertMarkdown);

// Start server
server.start(settings.port);

console.log(`
===========================================
  Markdown to HTML MCP Service
===========================================
  Price: $${parseInt(config.pricePerCall) / 1_000_000} USDC per call
  Owner: ${settings.ownerAddress}

  Tools:
    - convert_markdown

  Endpoints:
    POST /mcp                    - MCP JSON-RPC
    POST /tools/convert_markdown - REST API
    GET  /health                 - Health check
    GET  /info                   - Service info
===========================================
`);
