/**
 * UserOp Unit Test: Pull from pool + Pay for service
 *
 * Tests:
 *   1. Pull USDC from pool via UserOp
 *   2. Pay for a service via UserOp (approve + payForService)
 *
 * Usage:
 *   cd pragma-agent && npx tsx scripts/test-userop.ts
 *
 * Required env vars:
 *   BUNDLER_URL - Alchemy bundler URL
 *   REALLY_SECRET_PRIVATE_KEY - Private key of the EOA that owns the agent (from root .env)
 *   TEST_AGENT_ID - Agent ID
 *   TEST_SMART_ACCOUNT - Smart wallet address
 *   TEST_POOL_ADDRESS - Pool address
 */

import dotenv from "dotenv";
import path from "path";

// Load env files BEFORE importing config (which reads process.env at import time)
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../../.env") });

// Now require modules that depend on env vars
const { JsonRpcProvider, Contract, parseUnits, formatUnits } = require("ethers");
const config = require("../src/config.js");
const userop = require("../src/userop.js");

const {
  RPC_URL,
  USDC_ADDRESS,
  USDC_DECIMALS,
  ERC20_ABI,
  AGENT_POOL_ABI,
  BUNDLER_URL,
  X402_GATEWAY_ADDRESS,
  ENTRYPOINT_ADDRESS,
} = config;

const {
  sendUserOp,
  buildPoolPullCall,
  buildApproveCall,
  buildPayForServiceCall,
} = userop;

// ─── Config ─────────────────────────────────────────────────────────────────

// Use REALLY_SECRET_PRIVATE_KEY from root .env (fallback to TEST_OWNER_KEY)
const TEST_OWNER_KEY = process.env.REALLY_SECRET_PRIVATE_KEY || process.env.TEST_OWNER_KEY;
const TEST_AGENT_ID = process.env.TEST_AGENT_ID;
const TEST_SMART_ACCOUNT = process.env.TEST_SMART_ACCOUNT;
const TEST_POOL_ADDRESS = process.env.TEST_POOL_ADDRESS;
const TEST_SERVICE_ID = process.env.TEST_SERVICE_ID; // Optional: for pay test

const PULL_AMOUNT = process.env.PULL_AMOUNT || "0.01"; // USDC to pull

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(label: string, data: unknown) {
  console.log(`  ${label}:`, typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

async function checkBalances(provider: typeof JsonRpcProvider, smartAccount: string, poolAddress: string) {
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const pool = new Contract(poolAddress, AGENT_POOL_ABI, provider);
  const entryPoint = new Contract(ENTRYPOINT_ADDRESS, [
    "function balanceOf(address) view returns (uint256)",
  ], provider);

  const [usdcBalance, poolAssets, monBalance, epDeposit] = await Promise.all([
    usdc.balanceOf(smartAccount),
    pool.totalAssets(),
    provider.getBalance(smartAccount),
    entryPoint.balanceOf(smartAccount),
  ]);

  console.log("\n  Balances:");
  log("Smart Account USDC", `${formatUnits(usdcBalance, USDC_DECIMALS)} USDC`);
  log("Pool Total Assets", `${formatUnits(poolAssets, USDC_DECIMALS)} USDC`);
  log("Smart Account MON", `${formatUnits(monBalance, 18)} MON`);
  log("EntryPoint Deposit", `${formatUnits(epDeposit, 18)} MON`);
  console.log();

  return { usdcBalance, poolAssets, monBalance, epDeposit };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function testPull() {
  console.log("\n=== Test 1: Pull USDC from Pool via UserOp ===");

  if (!TEST_OWNER_KEY || !TEST_SMART_ACCOUNT || !TEST_POOL_ADDRESS) {
    console.log("  SKIP: Missing TEST_OWNER_KEY, TEST_SMART_ACCOUNT, or TEST_POOL_ADDRESS");
    return false;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const pullWei = parseUnits(PULL_AMOUNT, USDC_DECIMALS);

  console.log(`  Pulling ${PULL_AMOUNT} USDC from pool...`);
  log("Smart Account", TEST_SMART_ACCOUNT);
  log("Pool", TEST_POOL_ADDRESS);

  // Check balances before
  const before = await checkBalances(provider, TEST_SMART_ACCOUNT, TEST_POOL_ADDRESS);

  if (before.epDeposit < parseUnits("0.1", 18)) {
    console.log("  ERROR: Insufficient EntryPoint deposit. Fund with:");
    console.log(`    cast send 0x0000000071727De22E5E9d8BAf0edAc6f37da032 "depositTo(address)" ${TEST_SMART_ACCOUNT} --value 2ether --private-key <FUNDER_KEY> --rpc-url ${RPC_URL}`);
    return false;
  }

  try {
    const result = await sendUserOp(
      TEST_SMART_ACCOUNT as `0x${string}`,
      TEST_OWNER_KEY as `0x${string}`,
      [buildPoolPullCall(
        TEST_POOL_ADDRESS as `0x${string}`,
        TEST_SMART_ACCOUNT as `0x${string}`,
        pullWei
      )],
    );

    log("UserOp Hash", result.userOpHash);
    log("Tx Hash", result.txHash);
    log("Success", result.success);

    if (result.success) {
      // Check balances after
      console.log("\n  After pull:");
      await checkBalances(provider, TEST_SMART_ACCOUNT, TEST_POOL_ADDRESS);
      console.log("  PASS: Pull succeeded");
      return true;
    } else {
      console.log("  FAIL: UserOp failed");
      return false;
    }
  } catch (err) {
    console.log("  ERROR:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function testPayForService() {
  console.log("\n=== Test 2: Pay for Service via UserOp ===");

  if (!TEST_OWNER_KEY || !TEST_SMART_ACCOUNT || !TEST_SERVICE_ID) {
    console.log("  SKIP: Missing TEST_OWNER_KEY, TEST_SMART_ACCOUNT, or TEST_SERVICE_ID");
    return false;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);

  // Check USDC balance
  const usdcBalance: bigint = await usdc.balanceOf(TEST_SMART_ACCOUNT);
  log("Smart Account USDC", `${formatUnits(usdcBalance, USDC_DECIMALS)} USDC`);

  if (usdcBalance === 0n) {
    console.log("  SKIP: No USDC balance. Run pull test first.");
    return false;
  }

  // Get service price from registry
  const registry = new Contract(
    "0x7fc78b9769CF0739a5AC2a12D6BfCb121De12A59",
    ["function getService(bytes32) view returns (tuple(uint256 agentId, address owner, string name, uint256 pricePerCall, string endpoint, uint8 serviceType, uint8 paymentMode, bool active, uint256 totalCalls, uint256 totalRevenue))"],
    provider
  );
  const service = await registry.getService(TEST_SERVICE_ID);
  const payAmount: bigint = service.pricePerCall;

  log("Service Name", service.name);
  log("Service Price", `${formatUnits(payAmount, USDC_DECIMALS)} USDC`);

  if (usdcBalance < payAmount) {
    console.log(`  SKIP: Insufficient USDC balance. Need ${formatUnits(payAmount, USDC_DECIMALS)} USDC`);
    return false;
  }

  console.log(`  Paying ${formatUnits(payAmount, USDC_DECIMALS)} USDC for service ${TEST_SERVICE_ID}...`);

  try {
    const result = await sendUserOp(
      TEST_SMART_ACCOUNT as `0x${string}`,
      TEST_OWNER_KEY as `0x${string}`,
      [
        buildApproveCall(
          USDC_ADDRESS as `0x${string}`,
          X402_GATEWAY_ADDRESS as `0x${string}`,
          payAmount
        ),
        buildPayForServiceCall(
          TEST_SERVICE_ID as `0x${string}`,
          1n // quantity
        ),
      ],
    );

    log("UserOp Hash", result.userOpHash);
    log("Tx Hash", result.txHash);
    log("Success", result.success);

    if (result.success) {
      console.log("  PASS: Payment succeeded");
      return true;
    } else {
      console.log("  FAIL: UserOp failed");
      return false;
    }
  } catch (err) {
    console.log("  ERROR:", err instanceof Error ? err.message : err);
    return false;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== UserOp Unit Tests ===");
  console.log(`  RPC: ${RPC_URL}`);
  console.log(`  Bundler: ${BUNDLER_URL ? "configured" : "NOT SET"}`);
  console.log(`  Owner Key: ${TEST_OWNER_KEY ? "***configured***" : "NOT SET"}`);
  console.log(`  Agent ID: ${TEST_AGENT_ID || "NOT SET"}`);
  console.log(`  Smart Account: ${TEST_SMART_ACCOUNT || "NOT SET"}`);
  console.log(`  Pool: ${TEST_POOL_ADDRESS || "NOT SET"}`);
  console.log(`  Service ID: ${TEST_SERVICE_ID || "NOT SET (skip pay test)"}`);

  if (!BUNDLER_URL) {
    console.error("\nERROR: BUNDLER_URL is required");
    process.exit(1);
  }

  if (!TEST_OWNER_KEY) {
    console.error("\nERROR: REALLY_SECRET_PRIVATE_KEY (in root .env) or TEST_OWNER_KEY is required");
    process.exit(1);
  }

  const results: { test: string; passed: boolean }[] = [];

  // Test 1: Pull from pool
  const pullPassed = await testPull();
  results.push({ test: "Pull from pool", passed: pullPassed });

  // Wait a bit between tests
  await new Promise(r => setTimeout(r, 3000));

  // Test 2: Pay for service
  const payPassed = await testPayForService();
  results.push({ test: "Pay for service", passed: payPassed });

  // Summary
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.passed ? "PASS" : "FAIL/SKIP"}: ${r.test}`);
  }

  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
