import { Router, type Request, type Response } from "express";
import { JsonRpcProvider, Wallet, Contract, ethers } from "ethers";
import { config } from "../config.js";
import { syncDeployerNonce, allocateNonce } from "../services/nonceManager.js";

// ---------------------------------------------------------------------------
// ABIs (human-readable)
// ---------------------------------------------------------------------------

const IDENTITY_REGISTRY_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getAgentWallet(uint256 agentId) view returns (address)",
];

const AGENT_FACTORY_ABI = [
  "function setFundingConfig(uint256 agentId, bool needsFunding, uint16 splitRatio) external",
  "function getFundingConfig(uint256 agentId) view returns (bool needsFunding, uint16 splitRatio)",
];

const AGENT_ACCOUNT_FACTORY_ABI = [
  "function createAccount(address owner, address operator, bytes32 agentId, uint256 dailyLimit, uint256 expiresAt) returns (address)",
  "function getAddress(address owner, bytes32 agentId) view returns (address)",
];

const AGENT_SMART_ACCOUNT_ABI = [
  "function setTargetAllowed(address target, bool allowed)",
  "function setTokenAllowed(address token, bool allowed)",
];

const AGENT_POOL_FACTORY_ABI = [
  "function createAgentPool(uint256 agentId, address agentWallet, tuple(string agentURI, address asset, string name, string symbol, address poolOwner, uint256 dailyCap, uint64 vestingDuration, string metadataURI) params) returns (address)",
];
// Note: AgentFactory.createAgentPool automatically calls ReputationReporter.setReporter(agentAccount, true)

// ---------------------------------------------------------------------------
// Pending registration storage (keyed by operatorAddress)
// ---------------------------------------------------------------------------

interface PendingRegistration {
  operatorAddress: string;
  name: string;
  description: string;
  dailyLimit: string;
  expiryDays: number;
  poolDailyCap: string;
  poolVestingDays: number;
  metadataURI: string;
  fundTxHash: string;
  smartAccountAddress: string;
  createdAt: number;
}

const pendingRegistrations = new Map<string, PendingRegistration>();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const registerAgentRouter = Router();

// ---------------------------------------------------------------------------
// Phase 1: POST /fund — Send ETH to agent EOA for on-chain register()
// ---------------------------------------------------------------------------

interface FundBody {
  operatorAddress?: string;
  name?: string;
  description?: string;
  dailyLimit?: string;
  expiryDays?: number;
  poolDailyCap?: string;
  poolVestingDays?: number;
}

registerAgentRouter.post("/fund", async (req: Request, res: Response) => {
  try {
    const body = req.body as FundBody;
    const {
      operatorAddress,
      name,
      description,
      dailyLimit,
      expiryDays,
      poolDailyCap,
      poolVestingDays,
    } = body;

    // ---- Validation ----
    if (!operatorAddress || !ethers.isAddress(operatorAddress)) {
      res
        .status(400)
        .json({ error: "operatorAddress is required and must be a valid Ethereum address" });
      return;
    }
    if (!name || name.trim().length === 0) {
      res.status(400).json({ error: "name is required and must be non-empty" });
      return;
    }
    if (!dailyLimit || Number(dailyLimit) <= 0) {
      res.status(400).json({ error: "dailyLimit is required and must be > 0" });
      return;
    }

    // ---- Set up deployer signer ----
    const provider = new JsonRpcProvider(config.gatewayRpcUrl);
    const deployer = new Wallet(config.proxySignerKey, provider);

    // ---- Build metadata URI ----
    const metadataURI = JSON.stringify({
      name: name.trim(),
      description: (description ?? "").trim(),
    });

    // ---- Send ETH to agent EOA ----
    const deployerAddress = await deployer.getAddress();
    await syncDeployerNonce(provider, deployerAddress);

    const amount = ethers.parseEther(config.fundAmountEoa);
    const nonce = allocateNonce();
    console.log(`[register-agent/fund] Sending ${config.fundAmountEoa} ETH to ${operatorAddress}... (nonce=${nonce})`);

    const fundTx = await deployer.sendTransaction({ to: operatorAddress, value: amount, nonce });
    const fundReceipt = await fundTx.wait();

    // ---- Store pending registration ----
    const key = operatorAddress.toLowerCase();
    pendingRegistrations.set(key, {
      operatorAddress,
      name: name.trim(),
      description: (description ?? "").trim(),
      dailyLimit: dailyLimit,
      expiryDays: expiryDays ?? 365,
      poolDailyCap: poolDailyCap ?? "1000",
      poolVestingDays: poolVestingDays ?? 30,
      metadataURI,
      fundTxHash: fundReceipt!.hash,
      smartAccountAddress: "",
      createdAt: Date.now(),
    });

    console.log(
      `[register-agent/fund] Funded ${operatorAddress}, tx=${fundReceipt!.hash}`,
    );

    res.json({
      fundTxHash: fundReceipt!.hash,
      amount: config.fundAmountEoa,
      operatorAddress,
      metadataURI,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[register-agent/fund] Error:", message);
    res.status(500).json({ error: "Fund phase failed", details: message });
  }
});

// ---------------------------------------------------------------------------
// Phase 2: POST /setup — Deploy smart account + configure targets
// (NO pool creation — agentWallet must be set first)
// ---------------------------------------------------------------------------

interface SetupBody {
  operatorAddress?: string;
  agentId?: string;
}

registerAgentRouter.post("/setup", async (req: Request, res: Response) => {
  try {
    const body = req.body as SetupBody;
    const { operatorAddress, agentId } = body;

    // ---- Validation ----
    if (!operatorAddress || !ethers.isAddress(operatorAddress)) {
      res.status(400).json({ error: "operatorAddress is required and must be a valid Ethereum address" });
      return;
    }
    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    // ---- Retrieve pending registration ----
    const key = operatorAddress.toLowerCase();
    const pending = pendingRegistrations.get(key);
    if (!pending) {
      res.status(404).json({ error: `No pending registration found for ${operatorAddress}. Call /fund first.` });
      return;
    }

    // ---- Set up deployer signer ----
    const provider = new JsonRpcProvider(config.gatewayRpcUrl);
    const deployer = new Wallet(config.proxySignerKey, provider);
    const deployerAddress = await deployer.getAddress();

    // ---- Verify NFT ownership on-chain ----
    const identityRegistry = new Contract(
      config.identityRegistryAddress,
      IDENTITY_REGISTRY_ABI,
      provider,
    );

    const agentIdBigInt = BigInt(agentId);

    // Retry ownerOf — public RPCs behind load balancers return stale state
    // right after the agent's register() tx confirms on a different node.
    let nftOwner: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        nftOwner = await identityRegistry.ownerOf(agentIdBigInt);
        break;
      } catch {
        if (attempt < 4) {
          const delayMs = 2000 * (attempt + 1);
          console.log(`[register-agent/setup] ownerOf(${agentId}) not found yet, retrying in ${delayMs}ms (attempt ${attempt + 1}/5)...`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    if (!nftOwner) {
      res.status(404).json({ error: `agentId ${agentId} does not exist on-chain (after 5 retries)` });
      return;
    }

    if (nftOwner.toLowerCase() !== operatorAddress.toLowerCase()) {
      res.status(403).json({
        error: `NFT owner mismatch: expected ${operatorAddress}, got ${nftOwner}. Agent EOA must call register() first.`,
      });
      return;
    }

    const agentIdBytes32 = ethers.zeroPadValue(ethers.toBeHex(agentIdBigInt), 32);
    const txHashes: Record<string, string> = {};

    await syncDeployerNonce(provider, deployerAddress);

    // ---- Step 1: Deploy smart account ----
    const n1 = allocateNonce();
    console.log(`[register-agent/setup] Creating smart account for agentId=${agentId}... (nonce=${n1})`);
    const factory = new Contract(
      config.agentAccountFactoryAddress,
      AGENT_ACCOUNT_FACTORY_ABI,
      deployer,
    );

    const dailyLimitWei = ethers.parseUnits(pending.dailyLimit, 6);
    const expiresAtUnix = Math.floor(Date.now() / 1000) + pending.expiryDays * 86400;

    const createTx = await factory.createAccount(
      deployerAddress,
      operatorAddress,
      agentIdBytes32,
      dailyLimitWei,
      expiresAtUnix,
      { nonce: n1 },
    );
    const createReceipt = await createTx.wait();
    txHashes.createAccount = createReceipt.hash;

    // Compute smart account address
    const smartAccountAddress: string = await factory["getAddress(address,bytes32)"](deployerAddress, agentIdBytes32);
    console.log(`[register-agent/setup] Smart account: ${smartAccountAddress}, tx=${createReceipt.hash}`);

    // NOTE: No per-agent setTargetAllowed/setTokenAllowed calls needed here!
    // All system contracts (gateway, USDC, serviceRegistry, uniswapRouter, tokens, reputationReporter)
    // are now globally trusted on AgentAccountFactory. Only the per-agent pool address
    // (created in /finalize) needs individual allowlisting.

    console.log(`[register-agent/setup] System targets are globally trusted, no per-agent setup needed.`);

    // Store smart account address for /finalize phase
    pending.smartAccountAddress = smartAccountAddress;

    const deadline = Math.floor(Date.now() / 1000) + 270;

    console.log(
      `[register-agent/setup] Setup complete for agentId=${agentId}, smartAccount=${smartAccountAddress}`,
    );

    res.json({
      agentId,
      smartAccountAddress,
      deadline,
      deployerAddress,
      txHashes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[register-agent/setup] Error:", message);
    res.status(500).json({ error: "Setup phase failed", details: message });
  }
});

// ---------------------------------------------------------------------------
// Phase 3: POST /finalize — Create pool (after agent called setAgentWallet)
// AgentFactory.createAgentPool requires getAgentWallet(agentId) == smartAccount
// ---------------------------------------------------------------------------

interface FinalizeBody {
  operatorAddress?: string;
  agentId?: string;
  /** Whether agent needs investor funding (enables auto-split). Default: true */
  needsFunding?: boolean;
  /** Split ratio in basis points (e.g., 4000 = 40% to pool). Default: 4000 */
  splitRatio?: number;
}

registerAgentRouter.post("/finalize", async (req: Request, res: Response) => {
  try {
    const body = req.body as FinalizeBody;
    const { operatorAddress, agentId } = body;
    const needsFunding = body.needsFunding ?? true;  // default: needs funding
    const splitRatio = body.splitRatio ?? 4000;      // default: 40%

    // Initial delay to let previous transactions settle and nonces sync
    console.log("[register-agent/finalize] Waiting 3s for blockchain state to settle...");
    await new Promise((r) => setTimeout(r, 3000));

    // ---- Validation ----
    if (!operatorAddress || !ethers.isAddress(operatorAddress)) {
      res.status(400).json({ error: "operatorAddress is required and must be a valid Ethereum address" });
      return;
    }
    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    // ---- Retrieve pending registration ----
    const key = operatorAddress.toLowerCase();
    const pending = pendingRegistrations.get(key);
    if (!pending) {
      res.status(404).json({ error: `No pending registration found for ${operatorAddress}. Call /fund and /setup first.` });
      return;
    }
    if (!pending.smartAccountAddress) {
      res.status(400).json({ error: "Smart account not deployed yet. Call /setup first." });
      return;
    }

    const smartAccountAddress = pending.smartAccountAddress;

    // ---- Set up deployer signer ----
    const provider = new JsonRpcProvider(config.gatewayRpcUrl);
    const deployer = new Wallet(config.proxySignerKey, provider);
    const deployerAddress = await deployer.getAddress();

    // ---- Verify agentWallet is set to smart account ----
    const identityRegistry = new Contract(
      config.identityRegistryAddress,
      IDENTITY_REGISTRY_ABI,
      provider,
    );

    const agentIdBigInt = BigInt(agentId);

    // Retry getAgentWallet — stale RPC after agent's setAgentWallet() tx
    let agentWallet: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        agentWallet = await identityRegistry.getAgentWallet(agentIdBigInt);
        if (agentWallet && agentWallet.toLowerCase() === smartAccountAddress.toLowerCase()) {
          break;
        }
        // Wallet exists but doesn't match yet — RPC stale
        agentWallet = undefined;
      } catch {
        // ignore
      }
      if (attempt < 4) {
        const delayMs = 2000 * (attempt + 1);
        console.log(`[register-agent/finalize] agentWallet not set yet, retrying in ${delayMs}ms (attempt ${attempt + 1}/5)...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    if (!agentWallet) {
      res.status(400).json({
        error: `agentWallet for agentId ${agentId} is not set to ${smartAccountAddress}. Agent must call setAgentWallet() first.`,
      });
      return;
    }

    const txHashes: Record<string, string> = {};

    await syncDeployerNonce(provider, deployerAddress);

    let poolAddress = "";

    // ---- Step 1: Create agent pool (always created for all agents) ----
    const n1 = allocateNonce();
    console.log(`[register-agent/finalize] Creating agent pool for agentId=${agentId}... (nonce=${n1})`);
    const agentPoolFactory = new Contract(
      config.agentPoolFactoryAddress,
      AGENT_POOL_FACTORY_ABI,
      deployer,
    );

    const poolParams = {
      agentURI: pending.metadataURI,
      asset: config.usdcAddress,
      name: `${pending.name} Pool`,
      symbol: `af${pending.name.replace(/\s+/g, "").slice(0, 8)}`,
      poolOwner: deployerAddress,
      dailyCap: ethers.parseUnits(pending.poolDailyCap, 6),
      vestingDuration: BigInt(pending.poolVestingDays * 86400),
      metadataURI: pending.metadataURI,
    };

    const createPoolTx = await agentPoolFactory.createAgentPool(
      agentIdBigInt,
      smartAccountAddress,
      poolParams,
      { nonce: n1 },
    );
    const poolReceipt = await createPoolTx.wait();
    txHashes.createPool = poolReceipt.hash;

    // Extract pool address from AgentPoolCreated event
    const agentPoolCreatedTopic = ethers.id("AgentPoolCreated(address,uint256,address)");
    const poolLog = poolReceipt.logs.find(
      (l: { topics: readonly string[] }) => l.topics[0] === agentPoolCreatedTopic,
    );

    if (poolLog && "data" in poolLog) {
      const data = (poolLog as { data: string }).data;
      poolAddress = ethers.getAddress("0x" + data.slice(26, 66));
    }

    // ---- Step 2: Allow pool as target on smart account ----
    if (poolAddress) {
      // Brief delay to let pool creation tx propagate
      await new Promise((r) => setTimeout(r, 2000));
      await syncDeployerNonce(provider, deployerAddress);

      const n2 = allocateNonce();
      console.log(`[register-agent/finalize] Allowing pool ${poolAddress} as target... (nonce=${n2})`);
      const smartAccount = new Contract(
        smartAccountAddress,
        AGENT_SMART_ACCOUNT_ABI,
        deployer,
      );
      const allowPoolTx = await smartAccount.setTargetAllowed(poolAddress, true, { nonce: n2 });
      await allowPoolTx.wait();
      txHashes.allowPool = allowPoolTx.hash;
    }

    // ---- Step 3: Set funding config on AgentFactory ----
    // Brief delay between transactions
    await new Promise((r) => setTimeout(r, 2000));
    await syncDeployerNonce(provider, deployerAddress);

    const n3 = allocateNonce();
    console.log(`[register-agent/finalize] Setting funding config: needsFunding=${needsFunding}, splitRatio=${splitRatio}... (nonce=${n3})`);
    const agentFactoryWithSigner = new Contract(
      config.agentPoolFactoryAddress,
      AGENT_FACTORY_ABI,
      deployer,
    );
    const setConfigTx = await agentFactoryWithSigner.setFundingConfig(
      agentIdBigInt,
      needsFunding,
      splitRatio,
      { nonce: n3 },
    );
    await setConfigTx.wait();
    txHashes.setFundingConfig = setConfigTx.hash;

    // ---- Step 4: Fund smart account with ETH for self-pay UserOps ----
    // Note: AgentFactory.createAgentPool already registered the smart account as a reporter
    // Brief delay between transactions
    await new Promise((r) => setTimeout(r, 2000));
    await syncDeployerNonce(provider, deployerAddress);

    const fundAmount = ethers.parseEther(config.fundAmountEoa);
    const n4 = allocateNonce();
    console.log(`[register-agent/finalize] Funding smart account ${smartAccountAddress} with ${config.fundAmountEoa} ETH... (nonce=${n4})`);
    const fundSmartAccTx = await deployer.sendTransaction({ to: smartAccountAddress, value: fundAmount, nonce: n4 });
    const fundSmartAccReceipt = await fundSmartAccTx.wait();
    txHashes.fundSmartAccount = fundSmartAccReceipt!.hash;

    // ---- Cleanup ----
    pendingRegistrations.delete(key);

    console.log(
      `[register-agent/finalize] Done: agentId=${agentId}, pool=${poolAddress}, needsFunding=${needsFunding}, splitRatio=${splitRatio}`,
    );

    res.json({
      agentId,
      smartAccountAddress,
      poolAddress,
      needsFunding,
      splitRatio,
      txHashes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[register-agent/finalize] Error:", message);
    res.status(500).json({ error: "Finalize phase failed", details: message });
  }
});

// ---------------------------------------------------------------------------
// Self-Funded Path: POST /self-funded — Returns instructions for self-funded agents
// ---------------------------------------------------------------------------

registerAgentRouter.post("/self-funded", async (_req: Request, res: Response) => {
  // Returns instructions for agents who want to self-fund (needsFunding=false)
  res.json({
    success: true,
    agentType: "self-funded",
    instructions: {
      step1: {
        action: "Fund your EOA with MON",
        details: "Ensure your EOA has at least 0.001 MON for gas fees",
      },
      step2: {
        action: "Call IdentityRegistry.register()",
        contract: config.identityRegistryAddress,
        abi: "function register(string memory agentURI) external returns (uint256 agentId)",
        details: "This mints an identity NFT to your EOA",
      },
      step3: {
        action: "Set your agent wallet",
        contract: config.identityRegistryAddress,
        abi: "function setAgentWallet(uint256 agentId, address newWallet, uint256 deadline, bytes calldata signature) external",
        details: "Set your EOA or SmartAccount as the agentWallet using EIP-712 signature",
      },
      step4: {
        action: "Set funding config (self-funded)",
        contract: config.agentPoolFactoryAddress,
        abi: "function setFundingConfig(uint256 agentId, bool needsFunding, uint16 splitRatio) external",
        details: "Call with needsFunding=false, splitRatio=0 for no auto-split",
      },
      step5: {
        action: "(Optional) Create investor pool",
        contract: config.agentPoolFactoryAddress,
        abi: "function createAgentPool(uint256 agentId, address agentWallet, CreateParams calldata p) external returns (address pool)",
        details: "Pool for token appreciation via contribute(), no auto-split",
      },
      step6: {
        action: "Register your service",
        contract: config.serviceRegistryAddress,
        abi: "function registerService(bytes32 serviceId, uint256 agentId, string calldata name, uint256 pricePerCall, string calldata endpoint, ServiceType serviceType, PaymentMode paymentMode) external",
        details: "Use PaymentMode.NATIVE_X402 (value: 1) for services that handle x402 natively",
      },
    },
    contracts: {
      identityRegistry: config.identityRegistryAddress,
      serviceRegistry: config.serviceRegistryAddress,
      agentPoolFactory: config.agentPoolFactoryAddress,
      agentAccountFactory: config.agentAccountFactoryAddress,
      x402Gateway: config.gatewayAddress,
      usdc: config.usdcAddress,
    },
  });
});

// ---------------------------------------------------------------------------
// Fund EOA Only: POST /fund-eoa — Just sends MON to EOA without full registration flow
// ---------------------------------------------------------------------------

interface FundEoaBody {
  operatorAddress?: string;
}

registerAgentRouter.post("/fund-eoa", async (req: Request, res: Response) => {
  try {
    const body = req.body as FundEoaBody;
    const { operatorAddress } = body;

    // ---- Validation ----
    if (!operatorAddress || !ethers.isAddress(operatorAddress)) {
      res.status(400).json({ error: "operatorAddress is required and must be a valid Ethereum address" });
      return;
    }

    // ---- Set up deployer signer ----
    const provider = new JsonRpcProvider(config.gatewayRpcUrl);
    const deployer = new Wallet(config.proxySignerKey, provider);
    const deployerAddress = await deployer.getAddress();

    await syncDeployerNonce(provider, deployerAddress);

    // ---- Send ETH to agent EOA ----
    const amount = ethers.parseEther(config.fundAmountEoa);
    const nonce = allocateNonce();
    console.log(`[register-agent/fund-eoa] Sending ${config.fundAmountEoa} MON to ${operatorAddress}... (nonce=${nonce})`);

    const fundTx = await deployer.sendTransaction({ to: operatorAddress, value: amount, nonce });
    const fundReceipt = await fundTx.wait();

    console.log(`[register-agent/fund-eoa] Funded ${operatorAddress}, tx=${fundReceipt!.hash}`);

    res.json({
      success: true,
      fundTxHash: fundReceipt!.hash,
      amount: config.fundAmountEoa,
      operatorAddress,
      note: "EOA funded. You can now call IdentityRegistry.register() directly.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[register-agent/fund-eoa] Error:", message);
    res.status(500).json({ error: "Fund EOA failed", details: message });
  }
});
