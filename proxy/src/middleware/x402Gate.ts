import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ethers } from "ethers";

import { config } from "../config.js";
import { syncDeployerNonce, allocateNonce } from "../services/nonceManager.js";
import { getResource } from "../services/resourceStore.js";
import {
  createTransaction,
  recordTransaction,
  isPaymentIdUsed,
  markPaymentIdUsed,
} from "../models/Transaction.js";
import type {
  PaymentRequirementsAccept,
  X402ErrorResponse,
} from "../types/x402.js";

// ---------------------------------------------------------------------------
// Gateway ABI (minimal -- only the verifyPayment view function)
// ---------------------------------------------------------------------------

const GATEWAY_ABI = [
  "function verifyPayment(bytes32 paymentId) view returns (bool valid, address payer, uint256 amount)",
  "function getPayment(bytes32 paymentId) view returns (tuple(address payer, bytes32 serviceId, uint256 calls, uint256 amount, bool valid))",
];

const SERVICE_REGISTRY_ABI = [
  "function recordUsage(bytes32 serviceId, uint256 calls, uint256 revenue) external",
];

const SERVICE_REGISTRY_GETSERVICE_ABI = [
  "function getService(bytes32 serviceId) view returns (tuple(uint256 agentId, address owner, string name, uint256 pricePerCall, string endpoint, uint8 serviceType, uint8 paymentMode, bool active, uint256 totalCalls, uint256 totalRevenue))",
];

const AGENT_FACTORY_ABI = [
  "function poolByAgentId(uint256 agentId) view returns (address)",
  "function getFundingConfig(uint256 agentId) view returns (bool needsFunding, uint16 splitRatio)",
];

const IDENTITY_REGISTRY_ABI = [
  "function getAgentWallet(uint256 agentId) view returns (address)",
];

const ERC20_TRANSFER_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
];

const BPS = 10_000n;
const BYTES32_HEX_PATTERN = /^0x[0-9a-fA-F]{64}$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SplitTargets {
  agentWallet: string;
  pool: string;
}

/** On-chain payment mode enum values */
const PAYMENT_MODE = {
  PROXY_WRAPPED: 0,
  NATIVE_X402: 1,
} as const;

type PaymentModeType = "PROXY_WRAPPED" | "NATIVE_X402";

/** Agent-level funding configuration from IdentityRegistry */
interface AgentFundingConfig {
  needsFunding: boolean;
  splitRatio: number; // basis points (0-10000)
}

interface ServiceInfo {
  owner: string;
  agentId: bigint;
  paymentMode: PaymentModeType;
  fundingConfig: AgentFundingConfig;
  splitTargets: SplitTargets | null;
}

/**
 * Resolve on-chain service info: owner + paymentMode + agent funding config + split targets.
 * Only works for on-chain services (bytes32 hex: 0x + 64 hex chars).
 * Returns null on failure so callers can fall back to resource.creatorAddress.
 * splitTargets is null if the agent has no wallet or pool (graceful fallback).
 */
async function resolveServiceInfo(serviceId: string): Promise<ServiceInfo | null> {
  if (!BYTES32_HEX_PATTERN.test(serviceId)) {
    return null;
  }

  try {
    const provider = new ethers.JsonRpcProvider(config.gatewayRpcUrl);
    const registry = new ethers.Contract(
      config.serviceRegistryAddress,
      SERVICE_REGISTRY_GETSERVICE_ABI,
      provider
    );

    const service = await registry.getService(serviceId);
    const owner = service.owner as string;
    const agentId = service.agentId as bigint;
    const paymentModeNum = Number(service.paymentMode);
    const paymentMode: PaymentModeType = paymentModeNum === PAYMENT_MODE.NATIVE_X402
      ? "NATIVE_X402"
      : "PROXY_WRAPPED";

    if (!owner || owner === ethers.ZeroAddress) {
      return null;
    }

    console.log(`[x402Gate] Resolved on-chain owner for ${serviceId}: ${owner}, agentId=${agentId}, paymentMode=${paymentMode}`);

    // Fetch agent funding config + split targets
    let fundingConfig: AgentFundingConfig = { needsFunding: false, splitRatio: 0 };
    let splitTargets: SplitTargets | null = null;

    try {
      const identityRegistry = new ethers.Contract(
        config.identityRegistryAddress,
        IDENTITY_REGISTRY_ABI,
        provider
      );
      const agentFactory = new ethers.Contract(
        config.agentPoolFactoryAddress,
        AGENT_FACTORY_ABI,
        provider
      );

      const [[needsFunding, splitRatio], agentWallet, pool] = await Promise.all([
        agentFactory.getFundingConfig(agentId) as Promise<[boolean, number]>,
        identityRegistry.getAgentWallet(agentId) as Promise<string>,
        agentFactory.poolByAgentId(agentId) as Promise<string>,
      ]);

      fundingConfig = { needsFunding, splitRatio: Number(splitRatio) };
      console.log(`[x402Gate] Agent ${agentId} funding config: needsFunding=${needsFunding}, splitRatio=${splitRatio}`);

      if (
        agentWallet && agentWallet !== ethers.ZeroAddress &&
        pool && pool !== ethers.ZeroAddress
      ) {
        splitTargets = { agentWallet, pool };
        console.log(`[x402Gate] Split targets for agentId=${agentId}: wallet=${agentWallet}, pool=${pool}`);
      } else {
        console.log(`[x402Gate] No split targets for agentId=${agentId} (wallet=${agentWallet}, pool=${pool})`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[x402Gate] Failed to resolve agent config for agentId=${agentId}: ${message}`);
    }

    return { owner, agentId, paymentMode, fundingConfig, splitTargets };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[x402Gate] Failed to resolve service info for ${serviceId}: ${message}`);
    return null;
  }
}

/**
 * Determine whether the current request should be served for free
 * (no payment required).
 */
function isFreeRequest(req: Request): boolean {
  const { method, path } = req;

  // Explicit free routes
  if (method === "GET" && (path === "/health" || path === "/services")) {
    return true;
  }

  // MCP JSON-RPC: initialize and tools/list are free
  if (
    method === "POST" &&
    req.body &&
    typeof req.body === "object" &&
    "method" in req.body
  ) {
    const rpcMethod = (req.body as { method?: string }).method;
    if (rpcMethod === "initialize" || rpcMethod === "tools/list") {
      return true;
    }
  }

  return false;
}

/**
 * Cached proxy signer address to avoid repeated wallet instantiation.
 * Computed once on first access.
 */
let _cachedProxySignerAddress: string | null = null;

/**
 * Derive the proxy signer's address from the private key.
 * Cached after first call for efficiency.
 */
function computeProxySignerAddress(): string {
  if (!_cachedProxySignerAddress) {
    _cachedProxySignerAddress = new ethers.Wallet(config.proxySignerKey).address;
  }
  return _cachedProxySignerAddress;
}

/**
 * Create a signer for the deployer/proxy key, initializing the nonce manager
 * if needed. All deployer transactions must go through this to avoid nonce
 * collisions with other endpoints (registerAgent, fund-agent, etc.).
 */
async function getDeployerSigner(): Promise<ethers.Wallet> {
  const provider = new ethers.JsonRpcProvider(config.gatewayRpcUrl);
  const signer = new ethers.Wallet(config.proxySignerKey, provider);
  await syncDeployerNonce(provider, signer.address);
  return signer;
}

/**
 * Fire-and-forget: split USDC based on agent's configured splitRatio and record usage.
 * Called after x402 settlement when the agent needs funding and has split targets.
 * USDC arrives at proxy signer via x402, then gets distributed.
 */
function fireSplitAndRecordUsage(
  serviceId: string,
  totalAmount: string,
  targets: SplitTargets,
  splitRatio: number // basis points (e.g., 4000 = 40% to pool)
): void {
  if (!config.proxySignerKey) {
    console.warn("[x402Gate] No PROXY_SIGNER_KEY configured, skipping split");
    return;
  }

  const total = BigInt(totalAmount);
  const poolAmount = (total * BigInt(splitRatio)) / BPS;
  const walletAmount = total - poolAmount;
  const poolPct = (splitRatio / 100).toFixed(0);
  const walletPct = ((10000 - splitRatio) / 100).toFixed(0);

  (async () => {
    try {
      const signer = await getDeployerSigner();

      const usdc = new ethers.Contract(config.usdcAddress, ERC20_TRANSFER_ABI, signer);
      const registry = new ethers.Contract(config.serviceRegistryAddress, SERVICE_REGISTRY_ABI, signer);

      // 1. Transfer pool share
      if (poolAmount > 0n) {
        const nonce1 = allocateNonce();
        const tx1 = await usdc.transfer(targets.pool, poolAmount, { nonce: nonce1 });
        console.log(`[x402Gate] Split ${poolPct}% to pool ${targets.pool}: tx=${tx1.hash}`);
        await tx1.wait();
      }

      // 2. Transfer wallet share
      if (walletAmount > 0n) {
        const nonce2 = allocateNonce();
        const tx2 = await usdc.transfer(targets.agentWallet, walletAmount, { nonce: nonce2 });
        console.log(`[x402Gate] Split ${walletPct}% to wallet ${targets.agentWallet}: tx=${tx2.hash}`);
        await tx2.wait();
      }

      // 3. Record usage on-chain
      const nonce3 = allocateNonce();
      const tx3 = await registry.recordUsage(serviceId, 1, totalAmount, { nonce: nonce3 });
      console.log(`[x402Gate] recordUsage tx sent: ${tx3.hash}`);
      await tx3.wait();

      console.log(`[x402Gate] Split complete: pool=${poolAmount} (${poolPct}%), wallet=${walletAmount} (${walletPct}%), serviceId=${serviceId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[x402Gate] fireSplitAndRecordUsage failed: ${message} (USDC stays at proxy signer)`);
    }
  })();
}

/**
 * Fire-and-forget: call ServiceRegistry.recordUsage() on-chain.
 * Records x402 Path A usage stats without blocking the HTTP response.
 * Uses nonce manager to avoid conflicts with other deployer transactions.
 */
function fireRecordUsage(serviceId: string, calls: number, amount: string): void {
  if (!config.proxySignerKey) {
    console.warn("[x402Gate] No PROXY_SIGNER_KEY configured, skipping on-chain recordUsage");
    return;
  }

  // Only call for on-chain services (bytes32 hex: 0x + 64 hex chars)
  if (!BYTES32_HEX_PATTERN.test(serviceId)) {
    return;
  }

  (async () => {
    try {
      const signer = await getDeployerSigner();
      const registry = new ethers.Contract(
        config.serviceRegistryAddress,
        SERVICE_REGISTRY_ABI,
        signer
      );

      const nonce = allocateNonce();
      const tx = await registry.recordUsage(serviceId, calls, amount, { nonce });
      console.log(`[x402Gate] recordUsage tx sent: ${tx.hash}`);
      await tx.wait();
      console.log(`[x402Gate] recordUsage confirmed for serviceId=${serviceId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[x402Gate] recordUsage failed: ${message}`);
    }
  })();
}

/**
 * Build the x402 v2 payment requirements (accepted + resource objects).
 */
function buildPaymentRequirements(
  resource: { name: string; creatorAddress: string; pricing: { pricePerCall: string } },
  requestUrl: string,
  payToOverride?: string
): { accepted: PaymentRequirementsAccept; resource: { url: string; description: string; mimeType: string } } {
  // Build full URL for resource
  const fullUrl = requestUrl.startsWith("http")
    ? requestUrl
    : `http://localhost:${config.port}${requestUrl}`;

  return {
    accepted: {
      scheme: "exact",
      network: config.x402Network,
      amount: resource.pricing.pricePerCall,
      payTo: payToOverride ?? resource.creatorAddress,
      maxTimeoutSeconds: 60,
      asset: config.usdcAddress,
      extra: { name: "USDC", version: "2" },
    },
    resource: {
      url: fullUrl,
      description: resource.name,
      mimeType: "application/json",
    },
  };
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create an Express middleware that enforces dual payment verification.
 *
 * Path B  -- `x-payment-id` header (on-chain gateway paymentId for agents)
 *
 * If neither header is present the middleware responds with HTTP 402 and
 * the requirements that a client needs to fulfil.
 */
export function createX402Gate(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Free routes bypass payment
    if (isFreeRequest(req)) {
      next();
      return;
    }

    // 2. Resolve the resource from the route
    const resourceId = (req.params as Record<string, string>).resourceId;
    if (!resourceId) {
      res.status(400).json({ error: "Missing resourceId in route" });
      return;
    }

    const resource = getResource(resourceId);
    if (!resource) {
      res.status(404).json({ error: `Resource '${resourceId}' not found` });
      return;
    }

    // Resolve on-chain service info (owner + split targets)
    const serviceInfo = await resolveServiceInfo(resourceId);

    // Payment routing logic based on agent's needsFunding config:
    // needsFunding=true + has split targets → route to proxy signer for split
    // needsFunding=false or no split targets → pay owner directly
    // Fallback: pay resource.creatorAddress (off-chain resources)
    let payTo: string | undefined;
    if (
      serviceInfo?.fundingConfig?.needsFunding &&
      serviceInfo?.fundingConfig?.splitRatio > 0 &&
      serviceInfo?.splitTargets &&
      config.proxySignerKey
    ) {
      // Agent needs funding with valid split targets → route to proxy for split
      payTo = computeProxySignerAddress();
    } else if (serviceInfo?.owner) {
      // Self-funded or no split targets → pay owner directly
      payTo = serviceInfo.owner;
    } else {
      payTo = undefined; // Will use resource.creatorAddress in buildPaymentRequirements
    }
    const paymentReqs = buildPaymentRequirements(resource, req.originalUrl, payTo);

    // Store serviceInfo for post-payment handling
    (req as Request & { serviceInfo?: ServiceInfo | null }).serviceInfo = serviceInfo;

    // ------------------------------------------------------------------
    // Path A: PAYMENT-SIGNATURE header (x402 v2 facilitator flow)
    // ------------------------------------------------------------------
    const paymentSignature = req.headers["payment-signature"] as string | undefined;
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
            res.status(400).json({ error: "Invalid PAYMENT-SIGNATURE format" });
            return;
          }
        }

        // Forward to Monad facilitator for settlement
        const facilitatorUrl = "https://x402-facilitator.molandak.org";
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
          res.status(502).json({ error: "Facilitator error", details: responseText.slice(0, 200) });
          return;
        }

        if (!settleResult.success) {
          res.status(402).json({
            error: "Payment settlement failed",
            details: settleResult.errorReason || settleResult.error,
          });
          return;
        }

        // Payment verified and settled, record usage
        const storedServiceInfo = (req as Request & { serviceInfo?: ServiceInfo | null }).serviceInfo;
        if (
          storedServiceInfo?.fundingConfig?.needsFunding &&
          storedServiceInfo?.fundingConfig?.splitRatio > 0 &&
          storedServiceInfo?.splitTargets
        ) {
          fireSplitAndRecordUsage(
            resourceId,
            paymentReqs.accepted.amount,
            storedServiceInfo.splitTargets,
            storedServiceInfo.fundingConfig.splitRatio
          );
        } else {
          fireRecordUsage(resourceId, 1, paymentReqs.accepted.amount);
        }

        // Set payment response header
        res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify({
          success: true,
          transaction: settleResult.transaction,
        })).toString("base64"));

        next();
        return;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Payment verification error";
        console.error(`[x402Gate] Path A (facilitator) error: ${message}`);
        res.status(500).json({ error: message });
        return;
      }
    }

    // ------------------------------------------------------------------
    // Path B: x-payment-id header (on-chain gateway for agents)
    // ------------------------------------------------------------------
    const paymentId = req.headers["x-payment-id"] as string | undefined;
    if (paymentId) {
      try {
        // Replay protection: reject already-used paymentIds
        if (isPaymentIdUsed(paymentId)) {
          res.status(402).json({
            error: "Payment already used",
            paymentId,
          });
          return;
        }

        const provider = new ethers.JsonRpcProvider(config.gatewayRpcUrl);
        const gateway = new ethers.Contract(
          config.gatewayAddress,
          GATEWAY_ABI,
          provider
        );

        const [valid, payer, amount] = (await gateway.verifyPayment(
          paymentId
        )) as [boolean, string, bigint];

        if (!valid) {
          res.status(402).json({
            error: "Gateway payment verification failed",
            paymentId,
          });
          return;
        }

        // Ensure the payment covers the resource price
        const requiredAmount = BigInt(resource.pricing.pricePerCall);
        if (amount < requiredAmount) {
          res.status(402).json({
            error: "Insufficient payment amount",
            required: requiredAmount.toString(),
            received: amount.toString(),
          });
          return;
        }

        // Mark paymentId as used (prevents replay)
        markPaymentIdUsed(paymentId);

        // Record audit trail
        const tx = createTransaction({
          resourceId: resource.id,
          payer,
          amount: amount.toString(),
          method: "gateway",
          status: "verified",
          paymentId,
        });
        recordTransaction(tx);

        // Path B: x402Gateway already handles splitting at the contract level.
        // We only need to record usage stats (no proxy-side split needed).
        fireRecordUsage(resourceId, 1, amount.toString());

        next();
        return;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Gateway verification error";
        console.error(`[x402Gate] Path B error: ${message}`);
        res.status(500).json({ error: message });
        return;
      }
    }

    // ------------------------------------------------------------------
    // No payment header → respond 402 with requirements (x402 v2 format)
    // ------------------------------------------------------------------
    const errorBody: X402ErrorResponse = {
      x402Version: 2,
      accepts: [paymentReqs.accepted],
      resource: paymentReqs.resource,
    };

    res.setHeader(
      "PAYMENT-REQUIRED",
      Buffer.from(JSON.stringify(errorBody)).toString("base64")
    );
    res.status(402).json(errorBody);
  };
}
