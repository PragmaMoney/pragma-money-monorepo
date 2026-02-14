import { Router, type Request, type Response } from "express";
import { JsonRpcProvider, Contract, Wallet } from "ethers";
import { config } from "../config.js";
import { syncDeployerNonce, allocateNonce } from "../services/nonceManager.js";

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

const IDENTITY_REGISTRY_ABI = [
  "function getAgentWallet(uint256 agentId) view returns (address)",
];

const SERVICE_REGISTRY_ABI = [
  "function getService(bytes32 serviceId) view returns (tuple(uint256 agentId, address owner, string name, uint256 pricePerCall, string endpoint, uint8 serviceType, uint8 paymentMode, bool active, uint256 totalCalls, uint256 totalRevenue))",
  "function recordUsage(bytes32 serviceId, uint256 calls, uint256 revenue) external",
];

const AGENT_FACTORY_ABI = [
  "function poolByAgentId(uint256 agentId) view returns (address)",
  "function getFundingConfig(uint256 agentId) view returns (bool needsFunding, uint16 splitRatio)",
];

const ERC20_ABI = [
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
];

const BPS = 10_000n;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const reportRevenueRouter = Router();

// ---------------------------------------------------------------------------
// POST /report-revenue
//
// Called by NATIVE_X402 MCP servers after receiving x402 payment.
// Proxy verifies payment and triggers split based on agent's funding config.
//
// Body: {
//   serviceId: string,      // bytes32 service ID
//   amount: string,         // amount in USDC base units
//   paymentProof: {
//     txHash?: string,      // on-chain transaction hash
//     paymentId?: string,   // x402 payment ID
//   }
// }
// ---------------------------------------------------------------------------

interface ReportRevenueBody {
  serviceId?: string;
  amount?: string;
  paymentProof?: {
    txHash?: string;
    paymentId?: string;
  };
}

reportRevenueRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as ReportRevenueBody;
    const { serviceId, amount, paymentProof } = body;

    // Validate required fields
    if (!serviceId) {
      res.status(400).json({ error: "serviceId is required" });
      return;
    }
    if (!amount) {
      res.status(400).json({ error: "amount is required" });
      return;
    }
    if (!paymentProof || (!paymentProof.txHash && !paymentProof.paymentId)) {
      res.status(400).json({ error: "paymentProof with txHash or paymentId is required" });
      return;
    }

    const provider = new JsonRpcProvider(config.gatewayRpcUrl);

    // 1. Look up service to get agentId
    const serviceRegistry = new Contract(
      config.serviceRegistryAddress,
      SERVICE_REGISTRY_ABI,
      provider
    );

    let service: { agentId: bigint; owner: string; active: boolean };
    try {
      service = await serviceRegistry.getService(serviceId);
    } catch {
      res.status(404).json({ error: `Service ${serviceId} not found on-chain` });
      return;
    }

    if (!service.active) {
      res.status(400).json({ error: `Service ${serviceId} is not active` });
      return;
    }

    const agentId = service.agentId;

    // 2. Get agent's funding config (from AgentFactory)
    const agentFactory = new Contract(
      config.agentPoolFactoryAddress,
      AGENT_FACTORY_ABI,
      provider
    );

    const [needsFunding, splitRatio] = await agentFactory.getFundingConfig(agentId) as [boolean, number];
    const splitRatioBps = Number(splitRatio);

    console.log(`[reportRevenue] Service ${serviceId}, agentId=${agentId}, needsFunding=${needsFunding}, splitRatio=${splitRatioBps}`);

    // 3. Verify payment proof
    // For now, we trust the MCP server's report and log it
    // In production, you'd verify the txHash on-chain or check with facilitator
    // TODO: Add actual verification logic
    const verified = true;
    if (!verified) {
      res.status(400).json({ error: "Invalid payment proof" });
      return;
    }

    // 4. Record usage on-chain
    if (!config.proxySignerKey) {
      console.warn("[reportRevenue] No PROXY_SIGNER_KEY configured, skipping on-chain recording");
      res.json({
        success: true,
        serviceId,
        agentId: agentId.toString(),
        amount,
        needsFunding,
        splitRatio: splitRatioBps,
        recorded: false,
        split: false,
        note: "No proxy signer configured",
      });
      return;
    }

    const signer = new Wallet(config.proxySignerKey, provider);
    await syncDeployerNonce(provider, signer.address);

    const registryWithSigner = new Contract(
      config.serviceRegistryAddress,
      SERVICE_REGISTRY_ABI,
      signer
    );

    // Record usage
    const recordNonce = allocateNonce();
    const recordTx = await registryWithSigner.recordUsage(serviceId, 1, amount, { nonce: recordNonce });
    console.log(`[reportRevenue] recordUsage tx sent: ${recordTx.hash}`);
    await recordTx.wait();

    // 5. If agent needs funding and has split ratio, trigger split
    let splitTriggered = false;
    let poolAmount = "0";
    let splitTxHash: string | undefined;

    if (needsFunding && splitRatioBps > 0) {
      try {
        // Get agent wallet and pool addresses
        const identityRegistry = new Contract(
          config.identityRegistryAddress,
          IDENTITY_REGISTRY_ABI,
          provider
        );

        const [agentWallet, pool] = await Promise.all([
          identityRegistry.getAgentWallet(agentId) as Promise<string>,
          agentFactory.poolByAgentId(agentId) as Promise<string>,
        ]);

        if (agentWallet && pool && agentWallet !== "0x0000000000000000000000000000000000000000" && pool !== "0x0000000000000000000000000000000000000000") {
          // Agent's smart account must have pre-approved proxy signer for USDC transfers
          // We transfer from agentWallet to pool
          const total = BigInt(amount);
          const poolAmountBigInt = (total * BigInt(splitRatioBps)) / BPS;
          poolAmount = poolAmountBigInt.toString();

          if (poolAmountBigInt > 0n) {
            const usdc = new Contract(config.usdcAddress, ERC20_ABI, signer);
            const splitNonce = allocateNonce();
            const splitTx = await usdc.transferFrom(agentWallet, pool, poolAmountBigInt, { nonce: splitNonce });
            console.log(`[reportRevenue] Split ${splitRatioBps / 100}% to pool: tx=${splitTx.hash}`);
            await splitTx.wait();
            splitTriggered = true;
            splitTxHash = splitTx.hash;
          }
        } else {
          console.warn(`[reportRevenue] No valid split targets for agentId=${agentId}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[reportRevenue] Split failed: ${message}`);
        // Don't fail the request - usage was recorded, split just didn't work
      }
    }

    res.json({
      success: true,
      serviceId,
      agentId: agentId.toString(),
      amount,
      needsFunding,
      splitRatio: splitRatioBps,
      recorded: true,
      recordTxHash: recordTx.hash,
      split: splitTriggered,
      poolAmount: splitTriggered ? poolAmount : undefined,
      splitTxHash,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[reportRevenue] Error: ${message}`);
    res.status(500).json({ error: message });
  }
});
