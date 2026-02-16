import express, { Express, Request, Response } from "express";
import cors from "cors";
import { ethers } from "ethers";
import {
  MCPServiceConfig,
  MCPRequest,
  MCPResponse,
  MCPTool,
  ToolHandler,
  X402ErrorResponse,
  PaymentRequirementsAccept,
  X402Resource,
} from "./types";
import { verifyPayment } from "./x402-handler";

// ABIs for on-chain lookups
const SERVICE_REGISTRY_ABI = [
  "function getService(bytes32 serviceId) view returns (tuple(uint256 agentId, address owner, string name, uint256 pricePerCall, string endpoint, uint8 serviceType, uint8 paymentMode, bool active, uint256 totalCalls, uint256 totalRevenue))",
];

const IDENTITY_REGISTRY_ABI = [
  "function getAgentWallet(uint256 agentId) view returns (address)",
];

export class MCPServer {
  private app: Express;
  private config: MCPServiceConfig;
  private toolHandlers: Map<string, ToolHandler> = new Map();
  private fallbackOwnerAddress: string;
  private serviceId?: string; // bytes32 serviceId from on-chain registration
  private cachedPayTo?: string; // Cached payTo address from on-chain lookup

  constructor(config: MCPServiceConfig, ownerAddress: string, serviceId?: string) {
    this.config = config;
    this.fallbackOwnerAddress = ownerAddress;
    this.serviceId = serviceId;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Set the on-chain serviceId for dynamic owner resolution.
   * Call this after registering the service on-chain.
   */
  setServiceId(serviceId: string) {
    this.serviceId = serviceId;
    this.cachedPayTo = undefined; // Clear cache
  }

  /**
   * Resolve the payment recipient from on-chain ServiceRegistry.
   * Falls back to the configured ownerAddress if lookup fails.
   */
  private async resolvePayTo(): Promise<string> {
    // Return cached value if available
    if (this.cachedPayTo) {
      return this.cachedPayTo;
    }

    // If no serviceId, use fallback
    if (!this.serviceId) {
      return this.fallbackOwnerAddress;
    }

    try {
      const rpcUrl = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      const serviceRegistryAddress = process.env.SERVICE_REGISTRY_ADDRESS || "0x1d8E4C83BADf70F2AE7F03bc41bD450Bcc9FD7f8";
      const identityRegistryAddress = process.env.IDENTITY_REGISTRY_ADDRESS || "0x8004A818BFB912233c491871b3d84c89A494BD9e";

      // Get service from registry
      const serviceRegistry = new ethers.Contract(serviceRegistryAddress, SERVICE_REGISTRY_ABI, provider);
      const service = await serviceRegistry.getService(this.serviceId);

      if (!service || !service.active) {
        console.log(`[mcp-server] Service ${this.serviceId} not found or inactive, using fallback`);
        return this.fallbackOwnerAddress;
      }

      // Get agentWallet from IdentityRegistry
      const identityRegistry = new ethers.Contract(identityRegistryAddress, IDENTITY_REGISTRY_ABI, provider);
      const agentWallet = await identityRegistry.getAgentWallet(service.agentId);

      if (agentWallet && agentWallet !== ethers.ZeroAddress) {
        console.log(`[mcp-server] Resolved payTo for serviceId ${this.serviceId}: ${agentWallet} (agentId=${service.agentId})`);
        this.cachedPayTo = agentWallet;
        return agentWallet;
      }

      // Fallback to service owner if no wallet bound
      console.log(`[mcp-server] No agentWallet found, using service owner: ${service.owner}`);
      this.cachedPayTo = service.owner;
      return service.owner;
    } catch (error) {
      console.error(`[mcp-server] Failed to resolve payTo from chain:`, error);
      return this.fallbackOwnerAddress;
    }
  }

  private setupMiddleware() {
    this.app.use(cors({
      origin: "*",
      exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
    }));
    this.app.use(express.json());
  }

  private setupRoutes() {
    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", service: this.config.name });
    });

    // Service info
    this.app.get("/info", (_req, res) => {
      res.json({
        name: this.config.name,
        description: this.config.description,
        version: this.config.version,
        pricePerCall: this.config.pricePerCall,
        type: this.config.type,
        tools: this.config.tools.map((t) => t.name),
      });
    });

    // MCP JSON-RPC endpoint
    this.app.post("/mcp", this.handleMCP.bind(this));

    // Legacy REST endpoints for each tool
    for (const tool of this.config.tools) {
      this.app.post(`/tools/${tool.name}`, (req, res) =>
        this.handleToolCall(tool.name, req, res)
      );
    }
  }

  registerTool(name: string, handler: ToolHandler) {
    this.toolHandlers.set(name, handler);
  }

  private async handleMCP(req: Request, res: Response) {
    const mcpReq = req.body as MCPRequest;

    // Free methods (no payment required)
    if (mcpReq.method === "initialize") {
      return res.json(this.handleInitialize(mcpReq.id));
    }

    if (mcpReq.method === "tools/list") {
      return res.json(this.handleToolsList(mcpReq.id));
    }

    // Paid methods
    if (mcpReq.method === "tools/call") {
      return this.handleToolsCall(req, res, mcpReq);
    }

    // Unknown method
    res.json({
      jsonrpc: "2.0",
      error: { code: -32601, message: "Method not found" },
      id: mcpReq.id,
    });
  }

  private handleInitialize(id: number | string): MCPResponse {
    return {
      jsonrpc: "2.0",
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              protocolVersion: "2024-11-05",
              serverInfo: {
                name: this.config.name,
                version: this.config.version,
              },
              capabilities: {
                tools: { listChanged: false },
              },
            }),
          },
        ],
      },
      id,
    };
  }

  private handleToolsList(id: number | string): MCPResponse {
    const tools = this.config.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));

    return {
      jsonrpc: "2.0",
      result: {
        content: [{ type: "text", text: JSON.stringify({ tools }) }],
      },
      id,
    };
  }

  private async handleToolsCall(
    req: Request,
    res: Response,
    mcpReq: MCPRequest
  ) {
    const params = mcpReq.params as { name: string; arguments: Record<string, unknown> };
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    // Check payment - support both v2 (PAYMENT-SIGNATURE) and legacy (x-payment-id)
    const paymentSignature = req.headers["payment-signature"] as string | undefined;
    const paymentId = req.headers["x-payment-id"] as string | undefined;

    if (!paymentSignature && !paymentId) {
      const requirements = await this.getPaymentRequirements(req.originalUrl);
      // Set PAYMENT-REQUIRED header with base64-encoded body (x402 v2)
      res.setHeader(
        "PAYMENT-REQUIRED",
        Buffer.from(JSON.stringify(requirements)).toString("base64")
      );
      return res.status(402).json(requirements);
    }

    // Handle PAYMENT-SIGNATURE (x402 v2 facilitator flow)
    if (paymentSignature) {
      try {
        // Decode PAYMENT-SIGNATURE (base64 or raw JSON)
        let paymentData: unknown;
        try {
          const decoded = Buffer.from(paymentSignature, "base64").toString("utf-8");
          paymentData = JSON.parse(decoded);
        } catch {
          try {
            paymentData = JSON.parse(paymentSignature);
          } catch {
            return res.status(400).json({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Invalid PAYMENT-SIGNATURE format" },
              id: mcpReq.id,
            });
          }
        }

        // Forward to Monad facilitator for settlement
        const facilitatorUrl = process.env.FACILITATOR_URL || "https://x402-facilitator.molandak.org";
        const settleResponse = await fetch(`${facilitatorUrl}/settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(paymentData),
        });

        const responseText = await settleResponse.text();
        let settleResult: {
          success?: boolean;
          errorReason?: string;
          error?: string;
          transaction?: string;
        };

        try {
          settleResult = JSON.parse(responseText);
        } catch {
          return res.status(502).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Facilitator error", data: responseText.slice(0, 200) },
            id: mcpReq.id,
          });
        }

        if (!settleResult.success) {
          return res.status(402).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Payment settlement failed",
              data: settleResult.errorReason || settleResult.error,
            },
            id: mcpReq.id,
          });
        }

        // Set PAYMENT-RESPONSE header on success (x402 v2)
        res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({
          success: true,
          transaction: settleResult.transaction,
        })).toString("base64"));

        // Continue to execute tool below
      } catch (error) {
        const message = error instanceof Error ? error.message : "Payment verification error";
        console.error(`[mcp-server] PAYMENT-SIGNATURE error: ${message}`);
        return res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32000, message },
          id: mcpReq.id,
        });
      }
    } else if (paymentId) {
      // Legacy: Verify payment on-chain via x-payment-id
      const isValid = await verifyPayment(
        paymentId,
        BigInt(this.config.pricePerCall)
      );

      if (!isValid) {
        return res.status(402).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Payment verification failed" },
          id: mcpReq.id,
        });
      }

      // Set PAYMENT-RESPONSE header on success (x402 v2 compatibility)
      res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({
        success: true,
        paymentId,
      })).toString("base64"));
    }

    // Execute tool
    const handler = this.toolHandlers.get(toolName);
    if (!handler) {
      return res.json({
        jsonrpc: "2.0",
        error: { code: -32602, message: `Unknown tool: ${toolName}` },
        id: mcpReq.id,
      });
    }

    try {
      const content = await handler(toolArgs);
      res.json({
        jsonrpc: "2.0",
        result: { content },
        id: mcpReq.id,
      });
    } catch (error) {
      res.json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "Tool execution failed",
        },
        id: mcpReq.id,
      });
    }
  }

  private async handleToolCall(toolName: string, req: Request, res: Response) {
    // Check payment - support both v2 (PAYMENT-SIGNATURE) and legacy (x-payment-id)
    const paymentSignature = req.headers["payment-signature"] as string | undefined;
    const paymentId = req.headers["x-payment-id"] as string | undefined;

    if (!paymentSignature && !paymentId) {
      const requirements = await this.getPaymentRequirements(req.originalUrl);
      // Set PAYMENT-REQUIRED header with base64-encoded body (x402 v2)
      res.setHeader(
        "PAYMENT-REQUIRED",
        Buffer.from(JSON.stringify(requirements)).toString("base64")
      );
      return res.status(402).json(requirements);
    }

    // Handle PAYMENT-SIGNATURE (x402 v2 facilitator flow)
    if (paymentSignature) {
      try {
        // Decode PAYMENT-SIGNATURE (base64 or raw JSON)
        let paymentData: unknown;
        try {
          const decoded = Buffer.from(paymentSignature, "base64").toString("utf-8");
          paymentData = JSON.parse(decoded);
        } catch {
          try {
            paymentData = JSON.parse(paymentSignature);
          } catch {
            return res.status(400).json({ error: "Invalid PAYMENT-SIGNATURE format" });
          }
        }

        // Forward to Monad facilitator for settlement
        const facilitatorUrl = process.env.FACILITATOR_URL || "https://x402-facilitator.molandak.org";
        const settleResponse = await fetch(`${facilitatorUrl}/settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(paymentData),
        });

        const responseText = await settleResponse.text();
        let settleResult: {
          success?: boolean;
          errorReason?: string;
          error?: string;
          transaction?: string;
        };

        try {
          settleResult = JSON.parse(responseText);
        } catch {
          return res.status(502).json({ error: "Facilitator error", details: responseText.slice(0, 200) });
        }

        if (!settleResult.success) {
          return res.status(402).json({
            error: "Payment settlement failed",
            details: settleResult.errorReason || settleResult.error,
          });
        }

        // Set PAYMENT-RESPONSE header on success (x402 v2)
        res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({
          success: true,
          transaction: settleResult.transaction,
        })).toString("base64"));

        // Continue to execute tool below
      } catch (error) {
        const message = error instanceof Error ? error.message : "Payment verification error";
        console.error(`[mcp-server] PAYMENT-SIGNATURE error: ${message}`);
        return res.status(500).json({ error: message });
      }
    } else if (paymentId) {
      // Legacy: Verify payment on-chain via x-payment-id
      const isValid = await verifyPayment(
        paymentId,
        BigInt(this.config.pricePerCall)
      );

      if (!isValid) {
        return res.status(402).json({ error: "Payment verification failed" });
      }

      // Set PAYMENT-RESPONSE header on success (x402 v2 compatibility)
      res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({
        success: true,
        paymentId,
      })).toString("base64"));
    }

    // Execute tool
    const handler = this.toolHandlers.get(toolName);
    if (!handler) {
      return res.status(404).json({ error: `Unknown tool: ${toolName}` });
    }

    try {
      const content = await handler(req.body);
      res.json({ success: true, content });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Tool execution failed",
      });
    }
  }

  private async getPaymentRequirements(requestUrl?: string): Promise<X402ErrorResponse> {
    const payTo = await this.resolvePayTo();

    const accepts: PaymentRequirementsAccept[] = [
      {
        scheme: "exact",
        network: "eip155:10143", // CAIP-2 format for Monad Testnet
        amount: this.config.pricePerCall,
        payTo,
        asset: process.env.USDC_ADDRESS || "0x534b2f3A21130d7a60830c2Df862319e593943A3",
        maxTimeoutSeconds: 300,
        extra: {
          name: "USDC",
          version: "2",
        },
      },
    ];

    const resource: X402Resource = {
      url: requestUrl || `/mcp`,
      description: this.config.description,
      mimeType: "application/json",
    };

    return {
      x402Version: 2,
      accepts,
      resource,
    };
  }

  start(port: number = 3001) {
    this.app.listen(port, () => {
      console.log(`[${this.config.name}] MCP Server running on port ${port}`);
      console.log(`[${this.config.name}] Price: ${this.config.pricePerCall} atomic USDC per call`);
      console.log(`[${this.config.name}] Tools: ${this.config.tools.map((t) => t.name).join(", ")}`);
    });
  }

  getApp(): Express {
    return this.app;
  }
}
