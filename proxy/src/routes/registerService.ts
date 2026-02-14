import { Router, type Request, type Response } from "express";
import { JsonRpcProvider, Contract } from "ethers";
import { config } from "../config.js";
import { registerResource, getResource } from "../services/resourceStore.js";
import type { ServiceType } from "../types/x402.js";

// ---------------------------------------------------------------------------
// ABI (human-readable) — read-only, just getService
// ---------------------------------------------------------------------------

const SERVICE_REGISTRY_ABI = [
  "function getService(bytes32 serviceId) view returns (tuple(uint256 agentId, address owner, string name, uint256 pricePerCall, string endpoint, uint8 serviceType, uint8 paymentMode, bool active, uint256 totalCalls, uint256 totalRevenue))",
];

const SERVICE_TYPE_NAMES: Record<number, ServiceType> = {
  0: "COMPUTE",
  1: "STORAGE",
  2: "API",
  3: "AGENT",
  4: "OTHER",
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const registerServiceRouter = Router();

// ---------------------------------------------------------------------------
// POST /register-service
//
// Public route — on-chain existence is the auth.
// Reads the service from ServiceRegistry and creates a proxy resource.
//
// Body: { serviceId: string, originalUrl: string }
// ---------------------------------------------------------------------------

interface RegisterServiceBody {
  serviceId?: string;
  originalUrl?: string;
  paymentMode?: "PROXY_WRAPPED" | "NATIVE_X402";
  schema?: {
    input: object | null;
    output: object | null;
  };
}

registerServiceRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as RegisterServiceBody;
    const { serviceId, originalUrl } = body;

    if (!serviceId) {
      res.status(400).json({ error: "serviceId is required" });
      return;
    }
    if (!originalUrl) {
      res.status(400).json({ error: "originalUrl is required" });
      return;
    }

    // Read service from on-chain ServiceRegistry
    const provider = new JsonRpcProvider(config.gatewayRpcUrl);
    const registry = new Contract(
      config.serviceRegistryAddress,
      SERVICE_REGISTRY_ABI,
      provider,
    );

    let service: {
      agentId: bigint;
      owner: string;
      name: string;
      pricePerCall: bigint;
      endpoint: string;
      serviceType: number;
      paymentMode: number;
      active: boolean;
    };

    try {
      service = await registry.getService(serviceId);
    } catch {
      res.status(404).json({ error: `Service ${serviceId} not found on-chain` });
      return;
    }

    if (!service.active) {
      res.status(400).json({ error: `Service ${serviceId} is not active` });
      return;
    }

    // Map on-chain serviceType (uint8) to string
    const typeId = Number(service.serviceType);
    const serviceType: ServiceType = SERVICE_TYPE_NAMES[typeId] ?? "OTHER";

    // Extract schema from request body if provided
    const schema = body.schema;

    // Register in proxy resource store using full bytes32 serviceId
    const resource = registerResource({
      id: serviceId,
      name: service.name,
      type: serviceType,
      creatorAddress: service.owner,
      originalUrl,
      pricing: {
        pricePerCall: service.pricePerCall.toString(),
        currency: "USDC",
      },
      schema: schema ?? undefined,
    });

    console.log(
      `[register-service] Registered service ${service.name} (${serviceId}) → proxy ${resource.proxyUrl}`,
    );

    res.status(201).json({
      success: true,
      serviceId,
      name: service.name,
      proxyUrl: resource.proxyUrl,
      resourceId: resource.id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[register-service] Error:", message);
    res.status(500).json({ error: "Service registration failed", details: message });
  }
});

// ---------------------------------------------------------------------------
// GET /register-service/:serviceId/schema
//
// Returns the input/output schema for a service if defined.
// ---------------------------------------------------------------------------

registerServiceRouter.get("/:serviceId/schema", (req: Request, res: Response) => {
  const { serviceId } = req.params;
  const resource = getResource(serviceId);

  if (!resource) {
    res.status(404).json({ error: "Service not found" });
    return;
  }

  res.json({
    serviceId,
    schema: resource.schema ?? { input: null, output: null },
  });
});
