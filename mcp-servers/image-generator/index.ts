import "dotenv/config";
import { MCPServer } from "../shared/mcp-server";
import { config, settings } from "./config";
import { generateImage } from "./tools/generate-image";

// Validate configuration
if (!settings.ownerAddress) {
  console.error("ERROR: OWNER_ADDRESS environment variable is required");
  console.error("This is the address that will receive payments.");
  process.exit(1);
}

if (settings.provider !== "mock") {
  if (settings.provider === "openai" && !settings.openaiApiKey) {
    console.warn("WARNING: OPENAI_API_KEY not set, falling back to mock mode");
  }
  if (settings.provider === "replicate" && !settings.replicateApiKey) {
    console.warn("WARNING: REPLICATE_API_KEY not set, falling back to mock mode");
  }
}

// Create MCP server
const server = new MCPServer(config, settings.ownerAddress);

// Register tool handlers
server.registerTool("generate_image", generateImage);

// Start server
server.start(settings.port);

console.log(`
===========================================
  Image Generator MCP Service
===========================================
  Provider: ${settings.provider}
  Price: $${parseInt(config.pricePerCall) / 1_000_000} USDC per image
  Owner: ${settings.ownerAddress}

  Endpoints:
    POST /mcp          - MCP JSON-RPC
    POST /tools/generate_image - REST API
    GET  /health       - Health check
    GET  /info         - Service info
===========================================
`);
