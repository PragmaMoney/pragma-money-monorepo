#!/usr/bin/env npx tsx
/**
 * test-x402-flows.ts
 *
 * Comprehensive test script for x402 payment flow combinations:
 * - Buy Side: EOA Human, EOA Agent, Smart Account Agent
 * - Sell Side: PROXY_WRAPPED (with pool split), NATIVE_X402 (direct payment)
 * - Paths: Path A (Facilitator/PAYMENT-SIGNATURE), Path B (Gateway/x-payment-id)
 *
 * Test Matrix:
 * | # | Buyer              | Seller         | Path | Expected Behavior                    |
 * |---|--------------------|-----------     |------|--------------------------------------|
 * | 1 | EOA Human          | PROXY_WRAPPED  | A    | Facilitator → Proxy → 40/60 split   |
 * | 2 | EOA Human          | NATIVE_X402    | A    | Facilitator → Owner (100%)          |
 * | 3 | SmartAcct Agent    | PROXY_WRAPPED  | B    | Gateway splits 40/60                |
 * | 4 | SmartAcct Agent    | NATIVE_X402    | B    | Gateway → Owner (100%)              |
 * | 5 | EOA Agent (CLI)    | PROXY_WRAPPED  | A    | Facilitator → Proxy → 40/60 split   |
 * | 6 | EOA Agent (CLI)    | NATIVE_X402    | A    | Facilitator → Owner (100%)          |
 *
 * Usage:
 *   npx tsx scripts/test-x402-flows.ts setup           # Setup test services
 *   npx tsx scripts/test-x402-flows.ts test-gateway    # Test Path B (Gateway flow)
 *   npx tsx scripts/test-x402-flows.ts verify          # Verify on-chain state
 *   npx tsx scripts/test-x402-flows.ts all             # Run all tests
 */

import { Contract, JsonRpcProvider, formatUnits, parseUnits, keccak256, toUtf8Bytes, Wallet } from "ethers";
import * as fs from "fs";
import * as path from "path";
import {
  RPC_URL,
  USDC_ADDRESS,
  USDC_DECIMALS,
  SERVICE_REGISTRY_ADDRESS,
  SERVICE_REGISTRY_ABI,
  X402_GATEWAY_ADDRESS,
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
  AGENT_POOL_FACTORY_ADDRESS,
  AGENT_POOL_FACTORY_ABI,
  ERC20_ABI,
  AGENT_POOL_ABI,
  RELAYER_URL,
} from "../src/config.js";

// ─── Configuration ─────────────────────────────────────────────────────────

const PROXY_URL = process.env.PROXY_URL ?? RELAYER_URL;

// Test service prices
const TEST_PRICE_USDC = "0.02"; // $0.02 per call

// Additional ABIs not in config
const X402_GATEWAY_ABI_EXTENDED = [
  "function verifyPayment(bytes32 paymentId) view returns (bool valid, address payer, uint256 amount)",
  "function getPayment(bytes32 paymentId) view returns (tuple(address payer, bytes32 serviceId, uint256 calls, uint256 amount, bool valid))",
];

// Test data file
const TEST_DATA_PATH = path.join(__dirname, "../data/test-x402-flows.json");

interface TestData {
  proxyWrappedServiceId?: string;   // paymentMode = 0 (PROXY_WRAPPED)
  nativeX402ServiceId?: string;     // paymentMode = 1 (NATIVE_X402)
  proxyWrappedAgentId?: number;
  nativeX402AgentId?: number;
  proxyWrappedNeedsFunding?: boolean;
  proxyWrappedSplitRatio?: number;
  lastTestRun?: string;
  testResults?: Record<string, { success: boolean; message: string; timestamp: string }>;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function loadTestData(): TestData {
  try {
    if (fs.existsSync(TEST_DATA_PATH)) {
      return JSON.parse(fs.readFileSync(TEST_DATA_PATH, "utf-8"));
    }
  } catch {
    // ignore
  }
  return {};
}

function saveTestData(data: TestData): void {
  const dir = path.dirname(TEST_DATA_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(TEST_DATA_PATH, JSON.stringify(data, null, 2));
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function logSection(title: string): void {
  console.log("\n" + "=".repeat(60));
  console.log(`  ${title}`);
  console.log("=".repeat(60) + "\n");
}

// ─── Setup Phase ───────────────────────────────────────────────────────────

async function setupTestServices(): Promise<void> {
  logSection("Phase 1: Setup Test Services");

  const testData = loadTestData();

  // Check if services already exist
  if (testData.proxyWrappedServiceId && testData.nativeX402ServiceId) {
    log("Test services already configured.");
    log(`  PROXY_WRAPPED serviceId: ${testData.proxyWrappedServiceId}`);
    log(`  NATIVE_X402 serviceId: ${testData.nativeX402ServiceId}`);

    // Verify they still exist on-chain
    const provider = new JsonRpcProvider(RPC_URL);
    const registry = new Contract(SERVICE_REGISTRY_ADDRESS, SERVICE_REGISTRY_ABI, provider);

    try {
      const pw = await registry.getService(testData.proxyWrappedServiceId);
      const nx = await registry.getService(testData.nativeX402ServiceId);
      // Note: fundingModel field in contract is actually paymentMode
      log(`  PROXY_WRAPPED service active: ${pw.active}, paymentMode: ${pw.fundingModel} (0=PROXY_WRAPPED)`);
      log(`  NATIVE_X402 service active: ${nx.active}, paymentMode: ${nx.fundingModel} (1=NATIVE_X402)`);
      return;
    } catch (err) {
      log("Stored services not found on-chain. Re-registering...");
    }
  }

  log("To register test services, use the pragma-agent CLI:");
  log("");
  log("Prerequisites:");
  log("  1. Register an agent first with needsFunding=true for split testing:");
  log(`     npx pragma-agent register --name "TestAgent" --endpoint "https://test.com" \\`);
  log(`       --daily-limit 100 --expiry-days 90 --pool-daily-cap 50 \\`);
  log(`       --needs-funding true --split-ratio 4000`);
  log("");
  log("Step 1: Register PROXY_WRAPPED service (default paymentMode):");
  log(`  npx pragma-agent services register \\`);
  log(`    --name "test-proxy-wrapped" \\`);
  log(`    --price ${TEST_PRICE_USDC} \\`);
  log(`    --endpoint "https://httpbin.org/anything" \\`);
  log(`    --service-type API \\`);
  log(`    --payment-mode PROXY_WRAPPED`);
  log("");
  log("Step 2: Register NATIVE_X402 service:");
  log(`  npx pragma-agent services register \\`);
  log(`    --name "test-native-x402" \\`);
  log(`    --price ${TEST_PRICE_USDC} \\`);
  log(`    --endpoint "https://httpbin.org/anything" \\`);
  log(`    --service-type API \\`);
  log(`    --payment-mode NATIVE_X402`);
  log("");
  log("Step 3: Save the serviceIds to test data:");
  log(`  npx tsx scripts/test-x402-flows.ts save-services <PROXY_WRAPPED_ID> <NATIVE_X402_ID>`);
}

async function saveServiceIds(proxyWrappedId: string, nativeX402Id: string): Promise<void> {
  logSection("Saving Service IDs");

  // Verify services exist
  const provider = new JsonRpcProvider(RPC_URL);
  const registry = new Contract(SERVICE_REGISTRY_ADDRESS, SERVICE_REGISTRY_ABI, provider);
  const agentFactory = new Contract(AGENT_POOL_FACTORY_ADDRESS, AGENT_POOL_FACTORY_ABI, provider);

  try {
    const pw = await registry.getService(proxyWrappedId);
    // Note: fundingModel field in contract is actually paymentMode
    log(`PROXY_WRAPPED service: ${pw.name}, paymentMode=${pw.fundingModel}, active=${pw.active}`);
    if (Number(pw.fundingModel) !== 0) {
      log("WARNING: Expected paymentMode=0 (PROXY_WRAPPED), got " + pw.fundingModel);
    }

    const nx = await registry.getService(nativeX402Id);
    log(`NATIVE_X402 service: ${nx.name}, paymentMode=${nx.fundingModel}, active=${nx.active}`);
    if (Number(nx.fundingModel) !== 1) {
      log("WARNING: Expected paymentMode=1 (NATIVE_X402), got " + nx.fundingModel);
    }

    // Get agent funding config for split verification
    let needsFunding = true;
    let splitRatio = 4000;
    try {
      const fundingConfig = await agentFactory.getFundingConfig(pw.agentId);
      needsFunding = fundingConfig.needsFunding;
      splitRatio = Number(fundingConfig.splitRatio);
      log(`Agent ${pw.agentId} funding config: needsFunding=${needsFunding}, splitRatio=${splitRatio} (${splitRatio / 100}% to pool)`);
    } catch (err) {
      log("Could not fetch funding config (using defaults): " + (err instanceof Error ? err.message : String(err)));
    }

    const testData = loadTestData();
    testData.proxyWrappedServiceId = proxyWrappedId;
    testData.nativeX402ServiceId = nativeX402Id;
    testData.proxyWrappedAgentId = Number(pw.agentId);
    testData.nativeX402AgentId = Number(nx.agentId);
    testData.proxyWrappedNeedsFunding = needsFunding;
    testData.proxyWrappedSplitRatio = splitRatio;
    saveTestData(testData);

    log("Service IDs saved successfully.");
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── Test Path B (Gateway Flow) ────────────────────────────────────────────

async function testGatewayFlow(): Promise<void> {
  logSection("Phase 3: Test Path B (Gateway Flow)");

  const testData = loadTestData();

  if (!testData.proxyWrappedServiceId || !testData.nativeX402ServiceId) {
    log("Error: Test services not configured. Run 'setup' first.");
    process.exit(1);
  }

  log("═══════════════════════════════════════════════════════════════");
  log("For automated end-to-end testing with revenue split verification,");
  log("use the sim-flow script instead:");
  log("");
  log("  npx tsx scripts/sim-flow.ts --run test1 --step all");
  log("");
  log("This will:");
  log("  1. Create 2 fresh agents with needsFunding=true, splitRatio=4000");
  log("  2. Fund and seed their pools");
  log("  3. Register a service");
  log("  4. Make a payment");
  log("  5. Verify the 40/60 revenue split");
  log("═══════════════════════════════════════════════════════════════");
  log("");
  log("Manual Testing Commands:");
  log("");
  log("Test #3: SmartAcct Agent → PROXY_WRAPPED");
  log("  npx pragma-agent pay --service-id " + testData.proxyWrappedServiceId + " --calls 1 --score 85");
  log("  Expected: Revenue splits based on agent's splitRatio (e.g., 40% pool, 60% wallet)");
  log("");
  log("Test #4: SmartAcct Agent → NATIVE_X402");
  log("  npx pragma-agent pay --service-id " + testData.nativeX402ServiceId + " --calls 1 --score 85");
  log("  Expected: Payment goes to gateway, service must call /report-revenue for splits");
  log("");
  log("After each call, verify on-chain state with:");
  log("  npx tsx scripts/test-x402-flows.ts verify");
}

// ─── Verify On-Chain State ─────────────────────────────────────────────────

async function verifyOnChainState(): Promise<void> {
  logSection("Verification: On-Chain State");

  const testData = loadTestData();
  const provider = new JsonRpcProvider(RPC_URL);

  if (!testData.proxyWrappedServiceId || !testData.nativeX402ServiceId) {
    log("Error: Test services not configured. Run 'setup' first.");
    process.exit(1);
  }

  // Contracts
  const registry = new Contract(SERVICE_REGISTRY_ADDRESS, SERVICE_REGISTRY_ABI, provider);
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const identityRegistry = new Contract(IDENTITY_REGISTRY_ADDRESS, IDENTITY_REGISTRY_ABI, provider);
  const agentFactory = new Contract(AGENT_POOL_FACTORY_ADDRESS, AGENT_POOL_FACTORY_ABI, provider);

  // Check PROXY_WRAPPED service
  log("PROXY_WRAPPED Service (paymentMode=0):");
  try {
    const pw = await registry.getService(testData.proxyWrappedServiceId);
    log(`  Name: ${pw.name}`);
    log(`  Owner: ${pw.owner}`);
    log(`  AgentId: ${pw.agentId}`);
    log(`  Price: ${formatUnits(pw.pricePerCall, USDC_DECIMALS)} USDC`);
    log(`  PaymentMode: ${pw.fundingModel === 0n ? "PROXY_WRAPPED (0)" : "NATIVE_X402 (1)"}`);
    log(`  TotalCalls: ${pw.totalCalls}`);
    log(`  TotalRevenue: ${formatUnits(pw.totalRevenue, USDC_DECIMALS)} USDC`);

    // Get agent wallet and pool
    const agentWallet = await identityRegistry.getAgentWallet(pw.agentId);
    const poolAddress = await agentFactory.poolByAgentId(pw.agentId);

    log(`  AgentWallet: ${agentWallet}`);
    log(`  Pool: ${poolAddress}`);

    // Get funding config
    try {
      const fundingConfig = await agentFactory.getFundingConfig(pw.agentId);
      log(`  NeedsFunding: ${fundingConfig.needsFunding}`);
      log(`  SplitRatio: ${fundingConfig.splitRatio} (${Number(fundingConfig.splitRatio) / 100}% to pool)`);
    } catch {
      log(`  FundingConfig: Unable to fetch`);
    }

    // Check balances
    const walletBalance: bigint = await usdc.balanceOf(agentWallet);
    log(`  Wallet USDC: ${formatUnits(walletBalance, USDC_DECIMALS)}`);

    if (poolAddress !== "0x0000000000000000000000000000000000000000") {
      const poolContract = new Contract(poolAddress, AGENT_POOL_ABI, provider);
      const poolAssets: bigint = await poolContract.totalAssets();
      log(`  Pool TotalAssets: ${formatUnits(poolAssets, USDC_DECIMALS)} USDC`);
    }
  } catch (err) {
    log(`  Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  log("");

  // Check NATIVE_X402 service
  log("NATIVE_X402 Service (paymentMode=1):");
  try {
    const nx = await registry.getService(testData.nativeX402ServiceId);
    log(`  Name: ${nx.name}`);
    log(`  Owner: ${nx.owner}`);
    log(`  AgentId: ${nx.agentId}`);
    log(`  Price: ${formatUnits(nx.pricePerCall, USDC_DECIMALS)} USDC`);
    log(`  PaymentMode: ${nx.fundingModel === 0n ? "PROXY_WRAPPED (0)" : "NATIVE_X402 (1)"}`);
    log(`  TotalCalls: ${nx.totalCalls}`);
    log(`  TotalRevenue: ${formatUnits(nx.totalRevenue, USDC_DECIMALS)} USDC`);

    // Get agent wallet
    const agentWallet = await identityRegistry.getAgentWallet(nx.agentId);
    const poolAddress = await agentFactory.poolByAgentId(nx.agentId);

    log(`  AgentWallet: ${agentWallet}`);
    log(`  Pool: ${poolAddress}`);

    // Get funding config
    try {
      const fundingConfig = await agentFactory.getFundingConfig(nx.agentId);
      log(`  NeedsFunding: ${fundingConfig.needsFunding}`);
      log(`  SplitRatio: ${fundingConfig.splitRatio} (${Number(fundingConfig.splitRatio) / 100}% to pool)`);
      log(`  Note: NATIVE_X402 services need to call /report-revenue to trigger splits`);
    } catch {
      log(`  FundingConfig: Unable to fetch`);
    }

    // Check balance
    const walletBalance: bigint = await usdc.balanceOf(agentWallet);
    log(`  Wallet USDC: ${formatUnits(walletBalance, USDC_DECIMALS)}`);

    if (poolAddress !== "0x0000000000000000000000000000000000000000") {
      const poolContract = new Contract(poolAddress, AGENT_POOL_ABI, provider);
      const poolAssets: bigint = await poolContract.totalAssets();
      log(`  Pool TotalAssets: ${formatUnits(poolAssets, USDC_DECIMALS)} USDC`);
    }
  } catch (err) {
    log(`  Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Verify Payment ────────────────────────────────────────────────────────

async function verifyPayment(paymentId: string): Promise<void> {
  logSection("Payment Verification");

  const provider = new JsonRpcProvider(RPC_URL);
  const gateway = new Contract(X402_GATEWAY_ADDRESS, X402_GATEWAY_ABI_EXTENDED, provider);

  try {
    const [valid, payer, amount] = await gateway.verifyPayment(paymentId);
    log(`PaymentId: ${paymentId}`);
    log(`Valid: ${valid}`);
    log(`Payer: ${payer}`);
    log(`Amount: ${formatUnits(amount, USDC_DECIMALS)} USDC`);

    // Get full payment details
    const payment = await gateway.getPayment(paymentId);
    log(`ServiceId: ${payment.serviceId}`);
    log(`Calls: ${payment.calls}`);
  } catch (err) {
    log(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── List Services ─────────────────────────────────────────────────────────

async function listServices(): Promise<void> {
  logSection("Registered Services");

  const provider = new JsonRpcProvider(RPC_URL);
  const registry = new Contract(SERVICE_REGISTRY_ADDRESS, SERVICE_REGISTRY_ABI, provider);

  const count = await registry.getServiceCount();
  log(`Total services: ${count}`);

  for (let i = 0; i < Number(count); i++) {
    try {
      const serviceId = await registry.getServiceIdAt(i);
      const service = await registry.getService(serviceId);
      const fundingModel = Number(service.fundingModel) === 0 ? "PROXY_WRAPPED" : "NATIVE_X402";
      log(`  [${i}] ${service.name} (${fundingModel})`);
      log(`      serviceId: ${serviceId}`);
      log(`      price: ${formatUnits(service.pricePerCall, USDC_DECIMALS)} USDC`);
      log(`      active: ${service.active}`);
    } catch (err) {
      log(`  [${i}] Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "setup":
      await setupTestServices();
      break;

    case "save-services":
      const pwId = process.argv[3];
      const nxId = process.argv[4];
      if (!pwId || !nxId) {
        log("Usage: npx tsx scripts/test-x402-flows.ts save-services <PROXY_WRAPPED_ID> <NATIVE_X402_ID>");
        process.exit(1);
      }
      await saveServiceIds(pwId, nxId);
      break;

    case "test-gateway":
      await testGatewayFlow();
      break;

    case "verify":
      await verifyOnChainState();
      break;

    case "verify-payment":
      const paymentId = process.argv[3];
      if (!paymentId) {
        log("Usage: npx tsx scripts/test-x402-flows.ts verify-payment <PAYMENT_ID>");
        process.exit(1);
      }
      await verifyPayment(paymentId);
      break;

    case "list":
      await listServices();
      break;

    case "all":
      await setupTestServices();
      await testGatewayFlow();
      await verifyOnChainState();
      break;

    default:
      console.log(`
x402 Payment Flow Test Script

Usage:
  npx tsx scripts/test-x402-flows.ts <command>

Commands:
  setup                 Show instructions to register test services
  save-services <PW> <NX>  Save service IDs after registration
  test-gateway          Show instructions for Path B (Gateway) tests
  verify                Verify on-chain state of test services
  verify-payment <ID>   Verify a specific payment by paymentId
  list                  List all registered services
  all                   Run setup + test-gateway + verify

Environment:
  PROXY_URL            Proxy server URL (default: http://localhost:4402)
`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
