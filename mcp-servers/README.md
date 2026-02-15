# MCP Servers

Single Express server for all MCP services with x402 payment gating.

## Run

```bash
cp unified.env.example .env
# set OWNER_ADDRESS in .env
npm install
npm run dev
```

## Routing

All services are mounted on one server by prefix:

- `/image-generator/*`
- `/weather-api/*`
- `/qr-code-generator/*`
- `/hash-generator/*`
- `/json-formatter/*`
- `/currency-converter/*`
- `/url-metadata/*`
- `/markdown-to-html/*`

Examples:

- `POST /url-metadata/mcp`
- `POST /url-metadata/tools/extract_metadata`
- `GET /url-metadata/health`
- `GET /url-metadata/info`

Root endpoints:

- `GET /health`
- `GET /services`

## Layout

- `index.ts`: single server entrypoint and route mounting
- `shared/`: shared MCP/x402 server logic
- `<service>/config.ts` and `<service>/tools/*`: service definitions and tool handlers
