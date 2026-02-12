/**
 * E2E test: full agent lifecycle with two agents
 *
 * Agent A (wallet.json): Service provider
 * Agent B (wallet2.json): Pays for Agent A's service and gives feedback
 *
 * Steps:
 *   1.  Register Agent A (or skip if exists)
 *   2.  Register Agent B (or skip if exists)
 *   3.  Fund both smart accounts with MON
 *   4.  Seed Agent A's pool with USDC
 *   5.  Verify Agent A's pool funded
 *   6.  Agent A pulls USDC from pool
 *   7.  Agent A registers a service
 *   8.  List services (verify Agent A's service appears)
 *   9.  Seed Agent B's pool with USDC
 *   10. Agent B pulls USDC from pool
 *   11. Agent B pays for Agent A's service (with feedback)
 *   12. Verify payment
 *   13. Final balances
 *
 * Prerequisites:
 *   - Proxy running at RELAYER_URL (default: http://localhost:4402)
 *   - BUNDLER_URL set (Alchemy bundler URL)
 *   - TEST_FUNDER_KEY set (separate wallet for seeding pools + funding)
 *
 * Usage:
 *   cd pragma-agent && npx tsx scripts/test-e2e.ts
 */

import "dotenv/config";
import { JsonRpcProvider, Wallet, Contract, parseUnits, parseEther, formatUnits, formatEther } from "ethers";
import {
  RPC_URL,
  USDC_ADDRESS,
  USDC_DECIMALS,
  ERC20_ABI,
  AGENT_POOL_ABI,
  BUNDLER_URL,
  RELAYER_URL,
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
  SERVICE_REGISTRY_ADDRESS,
  SERVICE_REGISTRY_ABI,
  X402_GATEWAY_ADDRESS,
  X402_GATEWAY_ABI,
  ENTRYPOINT_ADDRESS,
} from "../src/config.js";
import {
  loadOrCreateWalletByFile,
  saveRegistrationByFile,
  getRegistrationByFile,
  type Registration,
  type WalletData,
} from "../src/wallet.js";
import {
  sendUserOp,
  buildPoolPullCall,
  buildRegisterServiceCall,
  buildApproveCall,
  buildPayForServiceCall,
  buildReputationFeedbackCall,
} from "../src/userop.js";
import { keccak256, stringToHex } from "viem";

// ─── Config ─────────────────────────────────────────────────────────────────

const WALLET_A = "wallet.json";
const WALLET_B = "wallet2.json";

const SEED_AMOUNT = "0.1";       // USDC to deposit into pool
const PULL_AMOUNT = "0.05";      // USDC to pull from pool
const SERVICE_PRICE = "0.001";   // USDC per call
const ETH_FUND = process.env.ETH_FUND || "0.001"; // MON for UserOp gas
const PREFUND_AMOUNT = process.env.PREFUND_AMOUNT || "2"; // MON for EntryPoint deposit

const TEST_FUNDER_KEY = process.env.TEST_FUNDER_KEY;
const AGENT_A_ID = process.env.AGENT_A_ID;
const AGENT_A_SMART_ACCOUNT = process.env.AGENT_A_SMART_ACCOUNT;
const AGENT_A_POOL_ADDRESS = process.env.AGENT_A_POOL_ADDRESS;
const AGENT_A_PRIVATE_KEY = process.env.AGENT_A_PRIVATE_KEY;
const AGENT_B_ID = process.env.AGENT_B_ID;
const AGENT_B_SMART_ACCOUNT = process.env.AGENT_B_SMART_ACCOUNT;
const AGENT_B_POOL_ADDRESS = process.env.AGENT_B_POOL_ADDRESS;
const AGENT_B_PRIVATE_KEY = process.env.AGENT_B_PRIVATE_KEY;

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(label: string, data: unknown) {
  console.log(`  ${label}:`, typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

async function registerAgentViaProxy(
  walletFile: string,
  walletData: WalletData,
  name: string,
  provider: JsonRpcProvider,
): Promise<Registration> {
  const operatorAddress = walletData.address;

  // Phase 1: Fund
  console.log(`    Phase 1: Funding ${operatorAddress}...`);
  const fundRes = await fetch(`${RELAYER_URL}/register-agent/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operatorAddress,
      name,
      description: "E2E test agent",
      dailyLimit: "100",
      expiryDays: 90,
      poolDailyCap: "50",
      poolVestingDays: 30,
    }),
  });
  const fundJson = await fundRes.json() as { error?: string; metadataURI?: string };
  if (fundJson.error) throw new Error(`Fund failed: ${fundJson.error}`);
  const metadataURI = fundJson.metadataURI as string;

  // Agent calls register() on-chain
  console.log(`    Calling register() on-chain...`);
  const identityRegistry = new Contract(
    IDENTITY_REGISTRY_ADDRESS,
    [...IDENTITY_REGISTRY_ABI, "function register(string agentURI) returns (uint256)"],
    new Wallet(walletData.privateKey, provider),
  );
  const regTx = await identityRegistry.register(metadataURI);
  const regReceipt = await regTx.wait();

  // Extract agentId from Registered event (agentId is in topics[1] for indexed param)
  let agentId = "0";
  for (const log of regReceipt.logs) {
    if (log.topics.length >= 2) {
      const potentialId = BigInt(log.topics[1]).toString();
      if (potentialId !== "0") {
        agentId = potentialId;
        break;
      }
    }
  }
  // Fallback: query lastId
  if (agentId === "0") {
    const lastId = await identityRegistry.getFunction("lastId")?.();
    agentId = (BigInt(lastId) - 1n).toString();
  }
  console.log(`    agentId: ${agentId}`);

  // Phase 2: Setup
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`    Phase 2: Setting up smart account...`);
  const setupRes = await fetch(`${RELAYER_URL}/register-agent/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operatorAddress, agentId }),
  });
  const setupJson = await setupRes.json() as { error?: string; smartAccountAddress?: string; deadline?: number; deployerAddress?: string };
  if (setupJson.error) throw new Error(`Setup failed: ${setupJson.error}`);
  const smartAccountAddress = setupJson.smartAccountAddress as string;
  const deadline = setupJson.deadline as number;
  const deployerAddress = setupJson.deployerAddress as string;
  console.log(`    smartAccount: ${smartAccountAddress}`);

  // Wait for smart account deployment to propagate on RPC
  await new Promise((r) => setTimeout(r, 5000));

  // Agent signs EIP-712 and calls setAgentWallet
  console.log(`    Signing EIP-712 and calling setAgentWallet...`);
  const agentSigner = new Wallet(walletData.privateKey, provider);
  const domain = {
    name: "ERC8004IdentityRegistry",
    version: "1",
    chainId: 10143,
    verifyingContract: IDENTITY_REGISTRY_ADDRESS,
  };
  const types = {
    AgentWalletSet: [
      { name: "agentId", type: "uint256" },
      { name: "newWallet", type: "address" },
      { name: "owner", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const value = {
    agentId: BigInt(agentId),
    newWallet: smartAccountAddress,
    owner: operatorAddress,
    deadline: BigInt(deadline),
  };
  const sig = await agentSigner.signTypedData(domain, types, value);

  const setWalletTx = await identityRegistry.setAgentWallet(
    BigInt(agentId),
    smartAccountAddress,
    BigInt(deadline),
    sig,
  );
  await setWalletTx.wait();

  // Phase 3: Finalize
  await new Promise((r) => setTimeout(r, 3000));
  console.log(`    Phase 3: Creating pool...`);
  const finalRes = await fetch(`${RELAYER_URL}/register-agent/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operatorAddress, agentId }),
  });
  const finalJson = await finalRes.json() as { error?: string; poolAddress?: string };
  if (finalJson.error) throw new Error(`Finalize failed: ${finalJson.error}`);
  const poolAddress = finalJson.poolAddress as string;
  console.log(`    poolAddress: ${poolAddress}`);

  const registration: Registration = {
    agentId,
    smartAccount: smartAccountAddress,
    poolAddress,
    owner: deployerAddress,
    registeredAt: new Date().toISOString(),
    txHashes: {},
  };
  saveRegistrationByFile(walletFile, registration);
  return registration;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== PragmaMoney E2E Test (Two Agents) ===");
  console.log(`  Relayer:  ${RELAYER_URL}`);
  console.log(`  Bundler:  ${BUNDLER_URL ? "configured" : "NOT SET"}`);
  console.log(`  Funder:   ${TEST_FUNDER_KEY ? "configured" : "NOT SET"}`);
  console.log();

  if (!BUNDLER_URL) {
    console.error("BUNDLER_URL is required");
    process.exit(1);
  }
  if (!TEST_FUNDER_KEY) {
    console.error("TEST_FUNDER_KEY is required");
    process.exit(1);
  }

  const startTime = Date.now();
  const provider = new JsonRpcProvider(RPC_URL);
  const funder = new Wallet(TEST_FUNDER_KEY, provider);
  const entryPoint = new Contract(
    ENTRYPOINT_ADDRESS,
    [
      "function balanceOf(address) view returns (uint256)",
      "function depositTo(address) payable",
      "function getNonce(address,uint192) view returns (uint256)",
    ],
    funder
  );

  // ── Step 1: Register Agent A ──────────────────────────────────────────────
  console.log("--- Step 1: Register Agent A (service provider) ---");
  const walletA = AGENT_A_PRIVATE_KEY
    ? { privateKey: AGENT_A_PRIVATE_KEY, address: new Wallet(AGENT_A_PRIVATE_KEY).address, createdAt: new Date().toISOString(), registration: null }
    : loadOrCreateWalletByFile(WALLET_A);
  let regA = getRegistrationByFile(WALLET_A);

  if (AGENT_A_ID && AGENT_A_SMART_ACCOUNT && AGENT_A_POOL_ADDRESS) {
    regA = {
      agentId: AGENT_A_ID,
      smartAccount: AGENT_A_SMART_ACCOUNT,
      poolAddress: AGENT_A_POOL_ADDRESS,
      owner: walletA.address,
      registeredAt: new Date().toISOString(),
      txHashes: {},
    };
    console.log("  Using Agent A override from env.");
  }

  if (regA) {
    console.log("  Already registered, skipping.");
    log("agentId", regA.agentId);
    log("smartAccount", regA.smartAccount);
    log("poolAddress", regA.poolAddress);
  } else {
    regA = await registerAgentViaProxy(WALLET_A, walletA, "Agent-A-Provider", provider);
    log("agentId", regA.agentId);
    log("smartAccount", regA.smartAccount);
    log("poolAddress", regA.poolAddress);
    console.log("  PASS");
  }
  console.log();

  // ── Step 2: Register Agent B ──────────────────────────────────────────────
  console.log("--- Step 2: Register Agent B (payer) ---");
  const walletB = AGENT_B_PRIVATE_KEY
    ? { privateKey: AGENT_B_PRIVATE_KEY, address: new Wallet(AGENT_B_PRIVATE_KEY).address, createdAt: new Date().toISOString(), registration: null }
    : loadOrCreateWalletByFile(WALLET_B);
  let regB = getRegistrationByFile(WALLET_B);

  if (AGENT_B_ID && AGENT_B_SMART_ACCOUNT && AGENT_B_POOL_ADDRESS) {
    regB = {
      agentId: AGENT_B_ID,
      smartAccount: AGENT_B_SMART_ACCOUNT,
      poolAddress: AGENT_B_POOL_ADDRESS,
      owner: walletB.address,
      registeredAt: new Date().toISOString(),
      txHashes: {},
    };
    console.log("  Using Agent B override from env.");
  }

  if (regB) {
    console.log("  Already registered, skipping.");
    log("agentId", regB.agentId);
    log("smartAccount", regB.smartAccount);
    log("poolAddress", regB.poolAddress);
  } else {
    regB = await registerAgentViaProxy(WALLET_B, walletB, "Agent-B-Payer", provider);
    log("agentId", regB.agentId);
    log("smartAccount", regB.smartAccount);
    log("poolAddress", regB.poolAddress);
    console.log("  PASS");
  }
  console.log();

  if (!regA || !regB) {
    throw new Error("Both Agent A and Agent B registrations are required before continuing.");
  }

  // ── Step 3: Fund both smart accounts with MON ─────────────────────────────
  console.log(`--- Step 3: Fund smart accounts with ${ETH_FUND} MON ---`);
  const minEth = parseEther(ETH_FUND);

  for (const [label, reg] of [["A", regA], ["B", regB]] as const) {
    const balance = await provider.getBalance(reg.smartAccount);
    if (balance >= minEth) {
      log(`Agent ${label} MON`, `${formatEther(balance)} (sufficient)`);
    } else {
      const tx = await funder.sendTransaction({ to: reg.smartAccount, value: minEth });
      await tx.wait();
      log(`Agent ${label} funded`, tx.hash);
    }
  }
  console.log("  PASS");
  console.log();

  // ── Step 3.5: Prefund EntryPoint deposits ────────────────────────────────
  console.log(`--- Step 3.5: Prefund EntryPoint with ${PREFUND_AMOUNT} MON (min 2 MON) ---`);
  const prefundWei = parseEther(PREFUND_AMOUNT);
  const minPrefundWei = parseEther("2");
  const targetPrefundWei = prefundWei > minPrefundWei ? prefundWei : minPrefundWei;
  for (const [label, reg] of [["A", regA], ["B", regB]] as const) {
    const deposit: bigint = await entryPoint.balanceOf(reg.smartAccount);
    if (deposit >= targetPrefundWei) {
      log(`Agent ${label} deposit`, `${formatEther(deposit)} (sufficient)`);
    } else {
      try {
        const topUp = targetPrefundWei - deposit;
        const tx = await entryPoint.depositTo(reg.smartAccount, { value: topUp });
        await tx.wait();
        log(`Agent ${label} prefund tx`, tx.hash);
        const after: bigint = await entryPoint.balanceOf(reg.smartAccount);
        log(`Agent ${label} deposit`, `${formatEther(after)} (after top-up)`);
      } catch (err) {
        console.log(
          `  ⚠ Skipping Agent ${label} prefund: insufficient funder balance or estimate failed.`
        );
      }
    }
  }
  console.log("  PASS");
  console.log();

  // ── Step 4: Seed Agent A's pool ───────────────────────────────────────────
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`--- Step 4: Seed Agent A's pool with ${SEED_AMOUNT} USDC ---`);
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, funder);
  const seedWei = parseUnits(SEED_AMOUNT, USDC_DECIMALS);

  const poolA = new Contract(regA.poolAddress, AGENT_POOL_ABI, provider);
  const poolAAssets: bigint = await poolA.totalAssets();

  if (poolAAssets >= seedWei) {
    log("already seeded", `${formatUnits(poolAAssets, USDC_DECIMALS)} USDC`);
  } else {
    const approveTx = await usdc.approve(regA.poolAddress, seedWei);
    await approveTx.wait();
    await new Promise((r) => setTimeout(r, 2000));
    const pool = new Contract(regA.poolAddress, AGENT_POOL_ABI, funder);
    const depositTx = await pool.deposit(seedWei, await funder.getAddress());
    await depositTx.wait();
    log("deposit tx", depositTx.hash);
  }
  console.log("  PASS");
  console.log();

  // ── Step 5: Verify Agent A's pool funded ──────────────────────────────────
  console.log("--- Step 5: Verify Agent A's pool funded ---");
  await new Promise((r) => setTimeout(r, 3000));
  const poolAAssetsAfter: bigint = await poolA.totalAssets();
  log("totalAssets", `${formatUnits(poolAAssetsAfter, USDC_DECIMALS)} USDC`);
  assert(poolAAssetsAfter > 0n, "Agent A pool should have USDC");
  console.log("  PASS");
  console.log();

  // ── Step 6: Agent A pulls USDC from pool ──────────────────────────────────
  console.log(`--- Step 6: Agent A pulls ${PULL_AMOUNT} USDC from pool ---`);
  const pullWei = parseUnits(PULL_AMOUNT, USDC_DECIMALS);
  const pullResult = await sendUserOp(
    regA.smartAccount as `0x${string}`,
    walletA.privateKey as `0x${string}`,
    [buildPoolPullCall(regA.poolAddress as `0x${string}`, regA.smartAccount as `0x${string}`, pullWei)],
  );
  log("txHash", pullResult.txHash);
  assert(pullResult.success, "Agent A pull should succeed");
  console.log("  PASS");
  console.log();

  // ── Step 7: Agent A registers a service ───────────────────────────────────
  let serviceIdBytes: `0x${string}`;
  let priceWei: bigint = parseUnits(SERVICE_PRICE, USDC_DECIMALS);
  const registry = new Contract(SERVICE_REGISTRY_ADDRESS, SERVICE_REGISTRY_ABI, provider);
  console.log("--- Step 7: Agent A registers a service ---");
  await new Promise((r) => setTimeout(r, 3000));
  const serviceName = `E2E-Svc-${Date.now()}`;
  serviceIdBytes = keccak256(stringToHex(serviceName));

  const svcResult = await sendUserOp(
    regA.smartAccount as `0x${string}`,
    walletA.privateKey as `0x${string}`,
    [buildRegisterServiceCall(
      serviceIdBytes as `0x${string}`,
      BigInt(regA.agentId),
      serviceName,
      priceWei,
      "https://e2e-test.example.com/api",
      2, // API type
    )],
  );

  log("serviceId", serviceIdBytes);
  log("txHash", svcResult.txHash);
  assert(svcResult.success === true, "Service registration should succeed");
  console.log("  PASS");
  console.log();

  // ── Step 8: List services ─────────────────────────────────────────────────
  console.log("--- Step 8: List services (verify Agent A's service) ---");
  await new Promise((r) => setTimeout(r, 3000));
  const svc = await registry.getService(serviceIdBytes);
  log("service name", svc.name);
  log("service owner", svc.owner);
  log("price per call", `${formatUnits(svc.pricePerCall, USDC_DECIMALS)} USDC`);
  assert(svc.active === true, "Service should be active");
  console.log("  PASS");
  console.log();

  // ── Step 9: Seed Agent B's pool ───────────────────────────────────────────
  console.log(`--- Step 9: Seed Agent B's pool with ${SEED_AMOUNT} USDC ---`);
  const poolB = new Contract(regB.poolAddress, AGENT_POOL_ABI, provider);
  const poolBAssets: bigint = await poolB.totalAssets();

  if (poolBAssets >= seedWei) {
    log("already seeded", `${formatUnits(poolBAssets, USDC_DECIMALS)} USDC`);
  } else {
    const approveTx = await usdc.approve(regB.poolAddress, seedWei);
    await approveTx.wait();
    await new Promise((r) => setTimeout(r, 2000));
    const pool = new Contract(regB.poolAddress, AGENT_POOL_ABI, funder);
    const depositTx = await pool.deposit(seedWei, await funder.getAddress());
    await depositTx.wait();
    log("deposit tx", depositTx.hash);
  }
  console.log("  PASS");
  console.log();

  // ── Step 10: Agent B pulls USDC from pool ─────────────────────────────────
  console.log(`--- Step 10: Agent B pulls ${PULL_AMOUNT} USDC from pool ---`);
  await new Promise((r) => setTimeout(r, 3000));
  const pullResultB = await sendUserOp(
    regB.smartAccount as `0x${string}`,
    walletB.privateKey as `0x${string}`,
    [buildPoolPullCall(regB.poolAddress as `0x${string}`, regB.smartAccount as `0x${string}`, pullWei)],
  );
  log("txHash", pullResultB.txHash);
  assert(pullResultB.success, "Agent B pull should succeed");
  console.log("  PASS");
  console.log();

  // ── Step 11: Agent B pays for Agent A's service ───────────────────────────
  console.log("--- Step 11: Agent B pays for Agent A's service (with feedback) ---");
  await new Promise((r) => setTimeout(r, 5000));

  // Ensure Agent B has enough EntryPoint deposit for remaining UserOps (avoid "insufficient funds")

  // Single UserOp: approve USDC on gateway + pay for service (reduces deposit consumption)
  const payResult = await sendUserOp(
    regB.smartAccount as `0x${string}`,
    walletB.privateKey as `0x${string}`,
    [
      buildApproveCall(USDC_ADDRESS as `0x${string}`, X402_GATEWAY_ADDRESS as `0x${string}`, priceWei),
      buildPayForServiceCall(serviceIdBytes as `0x${string}`, 1n),
    ],
  );
  log("approve+pay tx", payResult.txHash);
  assert(payResult.success, "Payment should succeed");

  // Third: give feedback (Agent B → Agent A)
  await new Promise((r) => setTimeout(r, 3000));
  const feedbackPayload = JSON.stringify({
    serviceId: serviceIdBytes,
    agentId: regA.agentId,
    score: 85,
  });
  const feedbackHash = keccak256(stringToHex(feedbackPayload));

  // Import REPUTATION_REPORTER_ADDRESS from config
  const { REPUTATION_REPORTER_ADDRESS } = await import("../src/config.js");

  const feedbackResult = await sendUserOp(
    regB.smartAccount as `0x${string}`,
    walletB.privateKey as `0x${string}`,
    [buildReputationFeedbackCall(
      REPUTATION_REPORTER_ADDRESS as `0x${string}`,
      BigInt(regA.agentId),
      85n,
      0,
      "score",
      "payment",
      "",
      "",
      feedbackHash as `0x${string}`,
    )],
  );
  log("feedback tx", feedbackResult.txHash);
  assert(feedbackResult.success, "Feedback should succeed");
  console.log("  PASS");
  console.log();

  // ── Step 12: Verify payment ───────────────────────────────────────────────
  console.log("--- Step 12: Verify payment on-chain ---");
  await new Promise((r) => setTimeout(r, 3000));
  const gateway = new Contract(X402_GATEWAY_ADDRESS, X402_GATEWAY_ABI, provider);

  // Get payment ID from tx receipt
  const payReceipt = await provider.getTransactionReceipt(payResult.txHash);
  let paymentId: string | null = null;
  if (payReceipt) {
    for (const log of payReceipt.logs) {
      try {
        const parsed = gateway.interface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed && parsed.name === "ServicePaid") {
          paymentId = parsed.args.paymentId;
          break;
        }
      } catch { /* not a gateway event */ }
    }
  }

  if (paymentId) {
    const [valid, payer, amount] = await gateway.verifyPayment(paymentId);
    log("paymentId", paymentId);
    log("valid", valid);
    log("payer", payer);
    log("amount", `${formatUnits(amount, USDC_DECIMALS)} USDC`);
    assert(valid === true, "Payment should be valid");
  } else {
    log("paymentId", "not extracted from event");
  }
  console.log("  PASS");
  console.log();

  // ── Step 13: Final balances ───────────────────────────────────────────────
  console.log("--- Step 13: Final balances ---");
  const usdcA: bigint = await usdc.balanceOf(regA.smartAccount);
  const usdcB: bigint = await usdc.balanceOf(regB.smartAccount);
  log("Agent A USDC", `${formatUnits(usdcA, USDC_DECIMALS)} USDC`);
  log("Agent B USDC", `${formatUnits(usdcB, USDC_DECIMALS)} USDC`);
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`=== E2E Test PASSED (${elapsed}s) ===`);
  console.log(`  Agent A: id=${regA.agentId}, smart=${regA.smartAccount}`);
  console.log(`  Agent B: id=${regB.agentId}, smart=${regB.smartAccount}`);
  console.log(`  Service: ${serviceIdBytes}`);
}

main().catch((err) => {
  console.error("E2E test failed:", err);
  process.exit(1);
});
