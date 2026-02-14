# MCP Servers - Monetizable MCP Services

Express servers that expose MCP (Model Context Protocol) tools with x402 payment gating.

## Overview

MCP servers are monetizable services that:
1. Expose tools via MCP JSON-RPC protocol
2. Require x402 payments for tool calls
3. Register on-chain in ServiceRegistry
4. Allow agents to monetize their endpoints

## Quick Start

```bash
# Image Generator (port 3001)
cd image-generator
cp .env.example .env
# Edit .env with your OWNER_ADDRESS
npm install
npm run dev

# Weather API (port 3002)
cd weather-api
cp .env.example .env
# Edit .env with your OWNER_ADDRESS
npm install
npm run dev
```

## Directory Structure

```
mcp-servers/
├── shared/                  # Shared utilities
│   ├── types.ts            # TypeScript types (includes FundingModel)
│   ├── mcp-server.ts       # Base MCP server class
│   ├── x402-handler.ts     # Payment verification
│   └── schema-validator.ts # Input validation
│
├── templates/
│   └── native-x402/        # Template for NATIVE_X402 services
│       ├── config.ts       # Config with fundingModel: "NATIVE_X402"
│       ├── tools/
│       │   └── example-tool.ts
│       └── index.ts
│
├── image-generator/        # AI image generation (PROXY_WRAPPED)
│   ├── config.ts          # $0.05/image, port 3001
│   ├── tools/
│   │   └── generate-image.ts
│   └── index.ts
│
├── weather-api/            # Weather data service (PROXY_WRAPPED)
│   ├── config.ts          # $0.0001/call, port 3002
│   ├── tools/
│   │   ├── get-current.ts
│   │   └── get-forecast.ts
│   └── index.ts
│
├── qr-code-generator/      # QR code generation (PROXY_WRAPPED)
│   ├── config.ts          # $0.01/call, port 3010
│   ├── tools/
│   │   └── generate-qr.ts
│   └── index.ts
│
├── hash-generator/         # Cryptographic hashes (PROXY_WRAPPED)
│   ├── config.ts          # $0.01/call, port 3011
│   ├── tools/
│   │   └── generate-hash.ts
│   └── index.ts
│
├── json-formatter/         # JSON format/validate/minify (PROXY_WRAPPED)
│   ├── config.ts          # $0.01/call, port 3012
│   ├── tools/
│   │   └── format-json.ts
│   └── index.ts
│
├── currency-converter/     # Currency exchange rates (NATIVE_X402)
│   ├── config.ts          # $0.02/call, port 3013
│   ├── tools/
│   │   └── convert-currency.ts
│   └── index.ts
│
├── url-metadata/           # URL metadata extraction (NATIVE_X402)
│   ├── config.ts          # $0.02/call, port 3014
│   ├── tools/
│   │   └── extract-metadata.ts
│   └── index.ts
│
└── markdown-to-html/       # Markdown conversion (PROXY_WRAPPED)
    ├── config.ts          # $0.01/call, port 3015
    ├── tools/
    │   └── convert-md.ts
    └── index.ts
```

## Available Services

| Service | Port | Price | Payment Mode | Description |
|---------|------|-------|--------------|-------------|
| Image Generator | 3001 | $0.05 | PROXY_WRAPPED | AI image generation (OpenAI/Replicate) |
| Weather API | 3002 | $0.0001 | PROXY_WRAPPED | Current weather & forecasts |
| QR Code Generator | 3010 | $0.01 | PROXY_WRAPPED | Generate QR codes from text/URLs |
| Hash Generator | 3011 | $0.01 | PROXY_WRAPPED | MD5, SHA256, SHA512 hashes |
| JSON Formatter | 3012 | $0.01 | PROXY_WRAPPED | Validate, format, minify JSON |
| Currency Converter | 3013 | $0.02 | NATIVE_X402 | Real-time currency conversion |
| URL Metadata | 3014 | $0.02 | NATIVE_X402 | Extract OG tags, title from URLs |
| Markdown to HTML | 3015 | $0.01 | PROXY_WRAPPED | Convert markdown to HTML |

## MCP Protocol

### Free Methods (no payment required)

```bash
# Initialize connection
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}'

# List available tools
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'
```

### Paid Methods (require x-payment-id)

```bash
# Without payment - returns 402
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{"name":"generate_image","arguments":{"prompt":"a cat"}},
    "id":3
  }'

# With payment - executes tool
curl -X POST http://localhost:3001/mcp \
  -H "Content-Type: application/json" \
  -H "x-payment-id: 0x..." \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "params":{"name":"generate_image","arguments":{"prompt":"a cat"}},
    "id":3
  }'
```

## Payment Flow

1. Agent calls `/mcp` with `tools/call`
2. Server returns HTTP 402 with payment requirements
3. Agent pays via x402Gateway on Monad Testnet
4. Agent retries with `x-payment-id` header
5. Server verifies payment on-chain
6. Server executes tool and returns result

## Creating a New Service

### Choosing a Payment Mode

MCP services support two payment modes:

| Model | Revenue Split | Pool Required | Best For |
|-------|---------------|---------------|----------|
| **PROXY_WRAPPED** (default) | 40% pool / 60% wallet | Yes | Agents seeking investor funding |
| **NATIVE_X402** | 100% to wallet | Optional | Self-funded agents |

### Route A: Proxy-Wrapped (Default)

Use existing services like `weather-api/` or `image-generator/` as templates:

1. Copy an existing service directory
2. Update `config.ts` with your service details
3. Implement tool handlers in `tools/`
4. Set `OWNER_ADDRESS` to your SmartAccount address
5. Register with default funding model (40/60 split)

### Route B: Native x402 (Self-Funded)

Use `templates/native-x402/` for direct payments without revenue split:

1. Copy `templates/native-x402/` to a new directory
2. Update `config.ts` with your service details and `fundingModel: "NATIVE_X402"`
3. Implement your tool handlers
4. Set `OWNER_ADDRESS` to your EOA or SmartAccount
5. Register with `--funding-model NATIVE_X402`

```bash
# Native x402 registration
pragma-agent services register \
  --name "my-service" \
  --price 0.01 \
  --endpoint "https://myservice.com/mcp" \
  --type API \
  --funding-model NATIVE_X402
```

### Example Config

```typescript
export const config: MCPServiceConfig = {
  name: "my-service",
  description: "My awesome service",
  version: "1.0.0",
  pricePerCall: "10000", // $0.01 per call
  type: "API",
  fundingModel: "NATIVE_X402", // or "PROXY_WRAPPED" (default)
  tools: [{
    name: "my_tool",
    description: "Does something cool",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string" }
      },
      required: ["input"]
    },
    outputSchema: {
      type: "object",
      properties: {
        result: { type: "string" }
      }
    }
  }]
};
```

## Registering On-Chain

After deploying your service, register it:

```bash
pragma-agent services register \
  --name "my-service" \
  --price 0.01 \
  --endpoint "https://myservice.com/mcp" \
  --type API
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port |
| `OWNER_ADDRESS` | Address to receive payments |
| `RPC_URL` | Monad Testnet RPC |
| `GATEWAY_ADDRESS` | x402 Gateway contract |
| `USDC_ADDRESS` | USDC token contract |

## Economics

| Service | Price | Typical Upstream Cost | Margin |
|---------|-------|----------------------|--------|
| Image Gen | $0.05 | $0.02-0.04 | 20-60% |
| Weather | $0.0001 | ~$0.00001 | 90%+ |

Service owners set prices to cover costs + profit. Market competition drives fair pricing.

## Testing

Both services support `mock` mode for testing without API keys:

```bash
AI_PROVIDER=mock npm run dev      # image-generator
WEATHER_PROVIDER=mock npm run dev # weather-api
```

Mock mode generates placeholder responses without calling external APIs.
