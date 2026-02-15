/**
 * Simulation flow script: step-by-step actions for two agents.
 *
 * Usage:
 *   npx tsx scripts/sim-flow.ts --run <id> --step init|register|seed|register-service|pay [--json]
 *
 * Notes:
 * - Creates fresh EOAs on init (per run).
 * - Uses unique service name/id per run unless overridden via env.
 * - Stores state in pragma-agent/sim-flows/<run>.json
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits,
} from "ethers";
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
  ENTRYPOINT_ADDRESS,
  AGENT_POOL_FACTORY_ADDRESS,
} from "../src/config.js";
import {
  sendUserOp,
  buildPoolPullCall,
  buildRegisterServiceCall,
} from "../src/userop.js";
import { keccak256, stringToHex } from "viem";
import { Interface } from "ethers";
import { handlePayWith } from "../src/pay.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_DIR = path.resolve(__dirname, "..", "sim-flows");

const STEP_VALUES = new Set([
  "init",
  "register",
  "seed",
  "register-service",
  "pay",
  "all",
  "reset",
]);

type WalletRecord = {
  privateKey: string;
  address: string;
  createdAt: string;
};

type Registration = {
  agentId: string;
  smartAccount: string;
  poolAddress: string;
  owner: string;
  registeredAt: string;
  txHashes: Record<string, string>;
  needsFunding: boolean;
  splitRatio: number;
};

type LogEntry = {
  ts: string;
  text: string;
};

type FlowState = {
  runId: string;
  createdAt: string;
  updatedAt: string;
  walletA?: WalletRecord;
  walletB?: WalletRecord;
  regA?: Registration;
  regB?: Registration;
  service?: {
    name: string;
    url: string;
    idHex: `0x${string}`;
    priceWei: string;
    ownerAgentId?: string;
  };
  notes?: string[];
  logs?: LogEntry[];
  txHashes?: Record<string, string>;
  balances?: {
    funderMon?: string;
    funderUsdc?: string;
    agentASmartMon?: string;
    agentASmartUsdc?: string;
    agentBSmartMon?: string;
    agentBSmartUsdc?: string;
    poolAUsdc?: string;
    poolBUsdc?: string;
  };
};

type CliArgs = {
  runId: string;
  step: string;
  json: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    args.set(key.slice(2), value);
  }
  const runId = args.get("run") || "default";
  const step = args.get("step") || "";
  const json = args.get("json") === "true";
  return { runId, step, json };
}

async function readState(runId: string): Promise<FlowState | null> {
  const file = path.join(STATE_DIR, `${runId}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as FlowState;
  } catch {
    return null;
  }
}

async function writeState(state: FlowState): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `${state.runId}.json`);
  await fs.writeFile(file, JSON.stringify(state, null, 2));
}

async function deleteState(runId: string): Promise<void> {
  const file = path.join(STATE_DIR, `${runId}.json`);
  try {
    await fs.rm(file);
  } catch {
    // ignore missing file
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeState(state: FlowState) {
  const clone = JSON.parse(JSON.stringify(state)) as FlowState;
  if (clone.walletA) clone.walletA.privateKey = "[redacted]";
  if (clone.walletB) clone.walletB.privateKey = "[redacted]";
  return clone;
}

function addLog(state: FlowState, text: string) {
  const entry = { ts: nowIso(), text };
  state.logs = [entry, ...(state.logs ?? [])].slice(0, 200);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sendSequentialTx(
  funder: Wallet,
  provider: JsonRpcProvider,
  tx: { to: string; value?: bigint },
): Promise<string> {
  const nonce = await provider.getTransactionCount(funder.address, "pending");
  const sent = await funder.sendTransaction({ ...tx, nonce });
  await sent.wait();
  return sent.hash;
}

async function sweepEoaToFunder(
  provider: JsonRpcProvider,
  wallet: WalletRecord,
  funderAddress: string,
): Promise<string | null> {
  const eoa = new Wallet(wallet.privateKey, provider);
  const balance = await provider.getBalance(eoa.address);
  if (balance === 0n) return null;

  const feeData = await provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!feePerGas) return null;

  const gasLimit = 21_000n;
  const gasCost = gasLimit * feePerGas;
  if (balance <= gasCost) return null;

  const value = balance - gasCost;
  const tx = await eoa.sendTransaction({ to: funderAddress, value });
  await tx.wait();
  return tx.hash;
}

async function sweepStateToFunder(provider: JsonRpcProvider, state: FlowState) {
  const funderKey = process.env.TEST_FUNDER_KEY;
  if (!funderKey) return;
  const funder = new Wallet(funderKey, provider);

  if (state.walletA) {
    await sweepEoaToFunder(provider, state.walletA, funder.address);
  }
  if (state.walletB) {
    await sweepEoaToFunder(provider, state.walletB, funder.address);
  }
}

async function findPoolCreatedTxHash(
  provider: JsonRpcProvider,
  agentId: string,
  poolAddress: string,
): Promise<string | null> {
  if (!AGENT_POOL_FACTORY_ADDRESS) return null;
  try {
    const iface = new Interface([
      "event AgentPoolCreated(address indexed agentAccount, uint256 indexed agentId, address pool)",
    ]);
    const event = iface.getEvent("AgentPoolCreated");
    if (!event) return null;
    const topic = event.topicHash;
    const agentIdTopic = `0x${BigInt(agentId).toString(16).padStart(64, "0")}`;
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 5000);
    const logs = await provider.getLogs({
      address: AGENT_POOL_FACTORY_ADDRESS,
      fromBlock,
      toBlock: latest,
      topics: [topic, null, agentIdTopic],
    });
    if (!logs.length) return null;
    const match = logs.find((log) => {
      const decoded = iface.parseLog(log);
      if (!decoded) return false;
      const pool = decoded.args.pool as string;
      return pool.toLowerCase() === poolAddress.toLowerCase();
    });
    return (match ?? logs[0]).transactionHash;
  } catch {
    return null;
  }
}

async function registerAgentViaProxy(
  walletData: WalletRecord,
  name: string,
  provider: JsonRpcProvider,
  options: { needsFunding?: boolean; splitRatio?: number } = {},
): Promise<Registration> {
  const needsFunding = options.needsFunding ?? true;
  const splitRatio = options.splitRatio ?? 4000; // 40% to pool by default
  const operatorAddress = walletData.address;

  const fundRes = await fetch(`${RELAYER_URL}/register-agent/fund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operatorAddress,
      name,
      description: "Simulation agent",
      dailyLimit: "100",
      expiryDays: 90,
      poolDailyCap: "50",
      poolVestingDays: 30,
    }),
  });
  const fundJson = (await fundRes.json()) as { error?: string; metadataURI?: string };
  if (fundJson.error) throw new Error(`Fund failed: ${fundJson.error}`);
  const metadataURI = fundJson.metadataURI as string;

  const identityRegistry = new Contract(
    IDENTITY_REGISTRY_ADDRESS,
    [...IDENTITY_REGISTRY_ABI, "function register(string agentURI) returns (uint256)"],
    new Wallet(walletData.privateKey, provider),
  );
  const regTx = await identityRegistry.register(metadataURI);
  const regReceipt = await regTx.wait();

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
  if (agentId === "0") {
    const lastId = await identityRegistry.getFunction("lastId")?.();
    agentId = (BigInt(lastId) - 1n).toString();
  }

  await new Promise((r) => setTimeout(r, 3000));

  const setupRes = await fetch(`${RELAYER_URL}/register-agent/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operatorAddress, agentId }),
  });
  const setupJson = (await setupRes.json()) as {
    error?: string;
    smartAccountAddress?: string;
    deadline?: number;
    deployerAddress?: string;
  };
  if (setupJson.error) throw new Error(`Setup failed: ${setupJson.error}`);
  const smartAccountAddress = setupJson.smartAccountAddress as string;
  const deadline = setupJson.deadline as number;
  const deployerAddress = setupJson.deployerAddress as string;

  await new Promise((r) => setTimeout(r, 5000));

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

  await new Promise((r) => setTimeout(r, 3000));

  const finalRes = await fetch(`${RELAYER_URL}/register-agent/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operatorAddress, agentId, needsFunding, splitRatio }),
  });
  const finalJson = (await finalRes.json()) as { error?: string; poolAddress?: string };
  if (finalJson.error) throw new Error(`Finalize failed: ${finalJson.error}`);
  const poolAddress = finalJson.poolAddress as string;

  return {
    agentId,
    smartAccount: smartAccountAddress,
    poolAddress,
    owner: deployerAddress,
    registeredAt: nowIso(),
    txHashes: {
      register: regTx.hash,
      setWallet: setWalletTx.hash,
    },
    needsFunding,
    splitRatio,
  };
}

async function stepInit(state: FlowState, provider: JsonRpcProvider) {
  const funderKey = process.env.TEST_FUNDER_KEY;
  assert(funderKey, "TEST_FUNDER_KEY is required for init step");

  const walletA = Wallet.createRandom();
  const walletB = Wallet.createRandom();

  const recordA: WalletRecord = {
    privateKey: walletA.privateKey,
    address: walletA.address,
    createdAt: nowIso(),
  };
  const recordB: WalletRecord = {
    privateKey: walletB.privateKey,
    address: walletB.address,
    createdAt: nowIso(),
  };

  const funder = new Wallet(funderKey, provider);
  const fundAmount = parseEther(process.env.ETH_FUND || "0.5");

  const fundTxA = await sendSequentialTx(funder, provider, { to: recordA.address, value: fundAmount });
  const fundTxB = await sendSequentialTx(funder, provider, { to: recordB.address, value: fundAmount });

  const funderBal = await provider.getBalance(funder.address);
  const agentABal = await provider.getBalance(recordA.address);
  const agentBBal = await provider.getBalance(recordB.address);

  state.walletA = recordA;
  state.walletB = recordB;
  state.regA = undefined;
  state.regB = undefined;
  state.service = undefined;
  state.txHashes = {
    fundA: fundTxA,
    fundB: fundTxB,
  };
  state.logs = [];
  addLog(state, "Initialized new EOAs.");
  addLog(state, `Agent A EOA: ${recordA.address} (funded ${formatEther(fundAmount)} MON).`);
  addLog(state, `Agent B EOA: ${recordB.address} (funded ${formatEther(fundAmount)} MON).`);
  addLog(state, `Funder address: ${funder.address}.`);
  addLog(state, `Funding tx A: ${fundTxA}.`);
  addLog(state, `Funding tx B: ${fundTxB}.`);
  addLog(state, `Funder balance: ${formatEther(funderBal)} MON.`);
  addLog(state, `Agent A EOA balance: ${formatEther(agentABal)} MON.`);
  addLog(state, `Agent B EOA balance: ${formatEther(agentBBal)} MON.`);
  addLog(state, `Contracts: IdentityRegistry ${IDENTITY_REGISTRY_ADDRESS}.`);
  addLog(state, `Contracts: ServiceRegistry ${SERVICE_REGISTRY_ADDRESS}.`);
  addLog(state, `Contracts: x402 Gateway ${X402_GATEWAY_ADDRESS}.`);
  addLog(state, `Contracts: EntryPoint ${ENTRYPOINT_ADDRESS}.`);
  state.notes = [
    `Funded Agent A EOA: ${recordA.address} (${formatEther(fundAmount)} MON)` ,
    `Funded Agent B EOA: ${recordB.address} (${formatEther(fundAmount)} MON)` ,
  ];
}

async function stepRegister(state: FlowState, provider: JsonRpcProvider) {
  assert(state.walletA && state.walletB, "Run init step first");

  if (!state.regA) {
    // Agent A: funded agent (40% to pool by default)
    state.regA = await registerAgentViaProxy(state.walletA, "Sim-Agent-A", provider, {
      needsFunding: true,
      splitRatio: 4000, // 40% to pool
    });
    const poolTxA = await findPoolCreatedTxHash(provider, state.regA.agentId, state.regA.poolAddress);
    state.txHashes = {
      ...(state.txHashes ?? {}),
      regA_register: state.regA.txHashes.register,
      regA_setWallet: state.regA.txHashes.setWallet,
      ...(poolTxA ? { regA_poolCreated: poolTxA } : {}),
    };
    addLog(state, `Agent A registered: agentId ${state.regA.agentId}.`);
    addLog(state, `Agent A smart account: ${state.regA.smartAccount}.`);
    addLog(state, `Agent A pool: ${state.regA.poolAddress}.`);
    addLog(state, `Agent A needsFunding: ${state.regA.needsFunding} (splitRatio: ${state.regA.splitRatio / 100}% to pool).`);
    addLog(state, `Agent A register tx: ${state.regA.txHashes.register}.`);
    addLog(state, `Agent A setWallet tx: ${state.regA.txHashes.setWallet}.`);
    if (poolTxA) {
      addLog(state, `Agent A pool created tx: ${poolTxA}.`);
    }
  }
  if (!state.regB) {
    // Agent B: also funded agent, will receive payments and split revenue
    state.regB = await registerAgentViaProxy(state.walletB, "Sim-Agent-B", provider, {
      needsFunding: true,
      splitRatio: 4000, // 40% to pool
    });
    const poolTxB = await findPoolCreatedTxHash(provider, state.regB.agentId, state.regB.poolAddress);
    state.txHashes = {
      ...(state.txHashes ?? {}),
      regB_register: state.regB.txHashes.register,
      regB_setWallet: state.regB.txHashes.setWallet,
      ...(poolTxB ? { regB_poolCreated: poolTxB } : {}),
    };
    addLog(state, `Agent B registered: agentId ${state.regB.agentId}.`);
    addLog(state, `Agent B smart account: ${state.regB.smartAccount}.`);
    addLog(state, `Agent B pool: ${state.regB.poolAddress}.`);
    addLog(state, `Agent B needsFunding: ${state.regB.needsFunding} (splitRatio: ${state.regB.splitRatio / 100}% to pool).`);
    addLog(state, `Agent B register tx: ${state.regB.txHashes.register}.`);
    addLog(state, `Agent B setWallet tx: ${state.regB.txHashes.setWallet}.`);
    if (poolTxB) {
      addLog(state, `Agent B pool created tx: ${poolTxB}.`);
    }
  }
}

async function stepSeed(state: FlowState, provider: JsonRpcProvider) {
  assert(state.regA && state.regB && state.walletA && state.walletB, "Run register step first");
  const funderKey = process.env.TEST_FUNDER_KEY;
  assert(funderKey, "TEST_FUNDER_KEY is required for seed step");

  const funder = new Wallet(funderKey, provider);
  const entryPoint = new Contract(
    ENTRYPOINT_ADDRESS,
    ["function balanceOf(address) view returns (uint256)", "function depositTo(address) payable"],
    funder,
  );

  const minEth = parseEther(process.env.ETH_FUND || "0.003");
  for (const reg of [state.regA, state.regB]) {
    const bal = await provider.getBalance(reg.smartAccount);
    if (bal < minEth) {
      const txHash = await sendSequentialTx(funder, provider, { to: reg.smartAccount, value: minEth });
      state.txHashes = {
        ...(state.txHashes ?? {}),
        [`fundSmart_${reg.smartAccount}`]: txHash,
      };
      addLog(state, `Funded smart account ${reg.smartAccount} with ${formatEther(minEth)} MON.`);
      addLog(state, `Fund smart tx: ${txHash}.`);
    }
  }

  const prefundWei = parseEther(process.env.PREFUND_AMOUNT || "2");
  for (const reg of [state.regA, state.regB]) {
    const deposit: bigint = await entryPoint.balanceOf(reg.smartAccount);
    if (deposit < prefundWei) {
      const tx = await entryPoint.depositTo(reg.smartAccount, { value: prefundWei - deposit });
      await tx.wait();
      state.txHashes = {
        ...(state.txHashes ?? {}),
        [`prefund_${reg.smartAccount}`]: tx.hash,
      };
      addLog(state, `EntryPoint prefund: ${reg.smartAccount} => ${formatEther(prefundWei)} MON.`);
      addLog(state, `Prefund tx: ${tx.hash}.`);
    }
  }

  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, funder);
  const seedAmount = parseUnits(process.env.SEED_AMOUNT || "1", USDC_DECIMALS);

  for (const reg of [state.regA, state.regB]) {
    const pool = new Contract(reg.poolAddress, AGENT_POOL_ABI, provider);
    const totalAssets: bigint = await pool.totalAssets();
    if (totalAssets < seedAmount) {
      const approveTx = await usdc.approve(reg.poolAddress, seedAmount);
      await approveTx.wait();
      state.txHashes = {
        ...(state.txHashes ?? {}),
        [`seedApprove_${reg.poolAddress}`]: approveTx.hash,
      };
      const poolSigner = new Contract(reg.poolAddress, AGENT_POOL_ABI, funder);
      const depositTx = await poolSigner.deposit(seedAmount, await funder.getAddress());
      await depositTx.wait();
      state.txHashes = {
        ...(state.txHashes ?? {}),
        [`seedDeposit_${reg.poolAddress}`]: depositTx.hash,
      };
      addLog(state, `Seeded pool ${reg.poolAddress} with ${formatUnits(seedAmount, USDC_DECIMALS)} USDC.`);
      addLog(state, `Seed approve tx: ${approveTx.hash}.`);
      addLog(state, `Seed deposit tx: ${depositTx.hash}.`);
    }
  }

  const pullAmount = parseUnits(process.env.PULL_AMOUNT || "0.5", USDC_DECIMALS);
  const pullResult = await sendUserOp(
    state.regA.smartAccount as `0x${string}`,
    state.walletA.privateKey as `0x${string}`,
    [buildPoolPullCall(state.regA.poolAddress as `0x${string}`, state.regA.smartAccount as `0x${string}`, pullAmount)],
  );
  if (pullResult.success) {
    state.txHashes = {
      ...(state.txHashes ?? {}),
      pullA: pullResult.txHash,
    };
    addLog(state, `Agent A pulled ${formatUnits(pullAmount, USDC_DECIMALS)} USDC from pool.`);
    addLog(state, `Pool pull tx: ${pullResult.txHash}.`);
  }

  const pullResultB = await sendUserOp(
    state.regB.smartAccount as `0x${string}`,
    state.walletB.privateKey as `0x${string}`,
    [buildPoolPullCall(state.regB.poolAddress as `0x${string}`, state.regB.smartAccount as `0x${string}`, pullAmount)],
  );
  if (pullResultB.success) {
    state.txHashes = {
      ...(state.txHashes ?? {}),
      pullB: pullResultB.txHash,
    };
    addLog(state, `Agent B pulled ${formatUnits(pullAmount, USDC_DECIMALS)} USDC from pool.`);
    addLog(state, `Pool pull tx (B): ${pullResultB.txHash}.`);
  }

  const funderMon = await provider.getBalance(funder.address);
  const funderUsdc: bigint = await usdc.balanceOf(funder.address);
  const agentAMon = await provider.getBalance(state.regA.smartAccount);
  const agentBMon = await provider.getBalance(state.regB.smartAccount);
  const agentAUsdc: bigint = await usdc.balanceOf(state.regA.smartAccount);
  const agentBUsdc: bigint = await usdc.balanceOf(state.regB.smartAccount);
  const poolA = new Contract(state.regA.poolAddress, AGENT_POOL_ABI, provider);
  const poolB = new Contract(state.regB.poolAddress, AGENT_POOL_ABI, provider);
  const poolAAssets: bigint = await poolA.totalAssets();
  const poolBAssets: bigint = await poolB.totalAssets();

  state.balances = {
    funderMon: formatEther(funderMon),
    funderUsdc: formatUnits(funderUsdc, USDC_DECIMALS),
    agentASmartMon: formatEther(agentAMon),
    agentASmartUsdc: formatUnits(agentAUsdc, USDC_DECIMALS),
    agentBSmartMon: formatEther(agentBMon),
    agentBSmartUsdc: formatUnits(agentBUsdc, USDC_DECIMALS),
    poolAUsdc: formatUnits(poolAAssets, USDC_DECIMALS),
    poolBUsdc: formatUnits(poolBAssets, USDC_DECIMALS),
  };

  addLog(state, `Funder balance: ${formatEther(funderMon)} MON, ${formatUnits(funderUsdc, USDC_DECIMALS)} USDC.`);
  addLog(state, `Agent A smart account: ${formatEther(agentAMon)} MON, ${formatUnits(agentAUsdc, USDC_DECIMALS)} USDC.`);
  addLog(state, `Agent B smart account: ${formatEther(agentBMon)} MON, ${formatUnits(agentBUsdc, USDC_DECIMALS)} USDC.`);
  addLog(state, `Pool A totalAssets: ${formatUnits(poolAAssets, USDC_DECIMALS)} USDC.`);
  addLog(state, `Pool B totalAssets: ${formatUnits(poolBAssets, USDC_DECIMALS)} USDC.`);
}

async function stepRegisterService(state: FlowState) {
  assert(state.regB && state.walletB, "Run register step first");
  const provider = new JsonRpcProvider(RPC_URL);
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const entryPoint = new Contract(
    ENTRYPOINT_ADDRESS,
    ["function balanceOf(address) view returns (uint256)"],
    provider,
  );
  const bMon = await provider.getBalance(state.regB.smartAccount);
  const bUsdc: bigint = await usdc.balanceOf(state.regB.smartAccount);
  const prefund: bigint = await entryPoint.balanceOf(state.regB.smartAccount);
  addLog(state, `Preflight: Agent B smart MON ${formatEther(bMon)}.`);
  addLog(state, `Preflight: Agent B smart USDC ${formatUnits(bUsdc, USDC_DECIMALS)}.`);
  addLog(state, `Preflight: EntryPoint deposit ${formatEther(prefund)} MON.`);

  const uniqueServiceSuffix = `${state.runId}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1_000_000)
    .toString(36)
    .padStart(4, "0")}`;
  const serviceName = process.env.SIM_SERVICE_NAME || `Simulation-Service-${uniqueServiceSuffix}`;
  const serviceUrl = process.env.SIM_SERVICE_URL || "https://sim.example.com/api";
  const priceWei = parseUnits(process.env.SERVICE_PRICE || "0.001", USDC_DECIMALS);

  const idHex = (process.env.SIM_SERVICE_ID as `0x${string}` | undefined)
    ?? keccak256(stringToHex(`${serviceName}-${uniqueServiceSuffix}`));

  const result = await sendUserOp(
    state.regB.smartAccount as `0x${string}`,
    state.walletB.privateKey as `0x${string}`,
    [
      buildRegisterServiceCall(
        idHex as `0x${string}`,
        BigInt(state.regB.agentId),
        serviceName,
        priceWei,
        serviceUrl,
        2,
      ),
    ],
  );

  if (!result.success) {
    throw new Error("Service registration failed");
  }

  state.service = {
    name: serviceName,
    url: serviceUrl,
    idHex,
    priceWei: priceWei.toString(),
    ownerAgentId: state.regB.agentId,
  };
  state.txHashes = {
    ...(state.txHashes ?? {}),
    registerService: result.txHash,
  };
  addLog(state, `Service registered by Agent B: ${serviceName}.`);
  addLog(state, `Service owner agentId: ${state.regB.agentId}.`);
  addLog(state, `Service owner smart account: ${state.regB.smartAccount}.`);
  addLog(state, `Service ID: ${idHex}.`);
  addLog(state, `Service URL: ${serviceUrl}.`);
  addLog(state, `Service price: ${formatUnits(priceWei, USDC_DECIMALS)} USDC.`);
  addLog(state, `Register service tx: ${result.txHash}.`);
}

async function stepPay(state: FlowState, provider: JsonRpcProvider) {
  assert(state.regA && state.regB && state.walletA && state.service, "Run register-service step first");

  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const poolB = new Contract(state.regB.poolAddress, AGENT_POOL_ABI, provider);

  // Track balances BEFORE payment for split verification
  const poolBAssetsBefore: bigint = await poolB.totalAssets();
  const agentBWalletBefore: bigint = await usdc.balanceOf(state.regB.smartAccount);
  addLog(state, `PRE-PAYMENT: Agent B pool assets: ${formatUnits(poolBAssetsBefore, USDC_DECIMALS)} USDC.`);
  addLog(state, `PRE-PAYMENT: Agent B wallet USDC: ${formatUnits(agentBWalletBefore, USDC_DECIMALS)} USDC.`);

  const payJson = await handlePayWith(
    {
      action: "pay",
      serviceId: state.service.idHex,
      calls: 1,
      score: 90,
      rpcUrl: RPC_URL,
    },
    { privateKey: state.walletA.privateKey, address: state.walletA.address },
    { smartAccount: state.regA.smartAccount }
  );
  const payResult = JSON.parse(payJson) as {
    success?: boolean;
    error?: string;
    txHash?: string;
    reputationTx?: string | null;
    paymentId?: string;
    userOpHash?: string;
    totalCost?: string;
    score?: number;
  };

  if (!payResult.success || !payResult.txHash) {
    throw new Error(payResult.error || "Payment failed");
  }

  state.txHashes = {
    ...(state.txHashes ?? {}),
    pay: payResult.txHash,
    ...(payResult.reputationTx ? { reputation: payResult.reputationTx } : {}),
  };
  addLog(state, `Agent A paid for service ${state.service.name} via x402 gateway.`);
  addLog(state, `Payer smart account: ${state.regA.smartAccount}.`);
  addLog(state, `Gateway: ${X402_GATEWAY_ADDRESS}.`);
  addLog(state, `Pay tx: ${payResult.txHash}.`);
  if (payResult.reputationTx) addLog(state, `Reputation tx: ${payResult.reputationTx}.`);
  if (payResult.paymentId) addLog(state, `Payment ID: ${payResult.paymentId}.`);
  if (payResult.totalCost) addLog(state, `Total cost: ${payResult.totalCost} USDC.`);
  if (typeof payResult.score === "number") addLog(state, `Score submitted: ${payResult.score}.`);

  const registry = new Contract(SERVICE_REGISTRY_ADDRESS, SERVICE_REGISTRY_ABI, provider);
  const svc = await registry.getService(state.service.idHex);
  if (!svc.active) {
    throw new Error("Service not active after payment");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REVENUE SPLIT VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  addLog(state, `--- REVENUE SPLIT VERIFICATION ---`);

  const poolBAssetsAfter: bigint = await poolB.totalAssets();
  const agentBWalletAfter: bigint = await usdc.balanceOf(state.regB.smartAccount);

  const poolBDelta = poolBAssetsAfter - poolBAssetsBefore;
  const walletBDelta = agentBWalletAfter - agentBWalletBefore;
  const totalReceived = poolBDelta + walletBDelta;

  addLog(state, `POST-PAYMENT: Agent B pool assets: ${formatUnits(poolBAssetsAfter, USDC_DECIMALS)} USDC.`);
  addLog(state, `POST-PAYMENT: Agent B wallet USDC: ${formatUnits(agentBWalletAfter, USDC_DECIMALS)} USDC.`);
  addLog(state, `Pool B delta: +${formatUnits(poolBDelta, USDC_DECIMALS)} USDC.`);
  addLog(state, `Wallet B delta: +${formatUnits(walletBDelta, USDC_DECIMALS)} USDC.`);
  addLog(state, `Total received: ${formatUnits(totalReceived, USDC_DECIMALS)} USDC.`);

  // Verify split ratio (Agent B has needsFunding=true, splitRatio=4000 = 40% to pool)
  const expectedSplitRatio = state.regB.splitRatio; // 4000 = 40%
  const expectedPoolShare = (totalReceived * BigInt(expectedSplitRatio)) / 10000n;
  const expectedWalletShare = totalReceived - expectedPoolShare;

  addLog(state, `Expected split (${expectedSplitRatio / 100}% to pool):`);
  addLog(state, `  - Pool should receive: ~${formatUnits(expectedPoolShare, USDC_DECIMALS)} USDC`);
  addLog(state, `  - Wallet should receive: ~${formatUnits(expectedWalletShare, USDC_DECIMALS)} USDC`);

  // Allow for small rounding differences (1 wei tolerance)
  const poolDiff = poolBDelta > expectedPoolShare ? poolBDelta - expectedPoolShare : expectedPoolShare - poolBDelta;
  const walletDiff = walletBDelta > expectedWalletShare ? walletBDelta - expectedWalletShare : expectedWalletShare - walletBDelta;

  if (poolDiff <= 1n && walletDiff <= 1n) {
    addLog(state, `✅ SPLIT VERIFIED: Revenue split correctly (${expectedSplitRatio / 100}% to pool, ${100 - expectedSplitRatio / 100}% to wallet).`);
  } else {
    addLog(state, `⚠️ SPLIT MISMATCH: Pool delta ${formatUnits(poolBDelta, USDC_DECIMALS)}, expected ${formatUnits(expectedPoolShare, USDC_DECIMALS)}.`);
    addLog(state, `⚠️ Wallet delta ${formatUnits(walletBDelta, USDC_DECIMALS)}, expected ${formatUnits(expectedWalletShare, USDC_DECIMALS)}.`);
  }

  // Update balances in state
  state.balances = {
    ...(state.balances ?? {}),
    poolBUsdc: formatUnits(poolBAssetsAfter, USDC_DECIMALS),
    agentBSmartUsdc: formatUnits(agentBWalletAfter, USDC_DECIMALS),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  assert(STEP_VALUES.has(args.step), `--step must be one of: ${[...STEP_VALUES].join(", ")}`);
  assert(BUNDLER_URL, "BUNDLER_URL is required");

  if (args.step === "reset") {
    const provider = new JsonRpcProvider(RPC_URL);
    const existing = await readState(args.runId);
    if (existing) {
      await sweepStateToFunder(provider, existing);
    }
    await deleteState(args.runId);
    const output = { ok: true, step: "reset", runId: args.runId, state: null };
    if (args.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Sim flow reset for run '${args.runId}'.`);
    }
    return;
  }

  const provider = new JsonRpcProvider(RPC_URL);
  let state = (await readState(args.runId)) ?? {
    runId: args.runId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    logs: [],
  };

  let lastLogCount = state.logs?.length ?? 0;

  const flush = (stepName: string) => {
    state.updatedAt = nowIso();
    return writeState(state).then(() => {
      const payload = {
        ok: true,
        step: stepName,
        runId: state.runId,
        state: sanitizeState(state),
      };
      if (args.json) {
        console.log(JSON.stringify(payload));
        if (state.logs && state.logs.length > lastLogCount) {
          const newLogs = state.logs.slice(0, state.logs.length - lastLogCount).reverse();
          for (const entry of newLogs) {
            console.error(`[${entry.ts}] ${entry.text}`);
          }
          lastLogCount = state.logs.length;
        }
      } else {
        console.log(`Sim flow step '${stepName}' completed for run '${state.runId}'.`);
        if (state.logs && state.logs.length > lastLogCount) {
          const newLogs = state.logs.slice(0, state.logs.length - lastLogCount).reverse();
          for (const entry of newLogs) {
            console.log(`[${entry.ts}] ${entry.text}`);
          }
          lastLogCount = state.logs.length;
        }
      }
    });
  };

  const step = args.step;
  if (step === "all") {
    await stepInit(state, provider);
    await flush("init");
    await stepRegister(state, provider);
    await flush("register");
    await stepSeed(state, provider);
    await flush("seed");
    await stepRegisterService(state);
    await flush("register-service");
    await stepPay(state, provider);
    await flush("pay");
  } else if (step === "init") {
    await stepInit(state, provider);
    await flush("init");
  } else if (step === "register") {
    await stepRegister(state, provider);
    await flush("register");
  } else if (step === "seed") {
    await stepSeed(state, provider);
    await flush("seed");
  } else if (step === "register-service") {
    await stepRegisterService(state);
    await flush("register-service");
  } else if (step === "pay") {
    await stepPay(state, provider);
    await flush("pay");
  }
}

main().catch(async (err) => {
  console.error("Sim flow failed:", err);
  try {
    const args = parseArgs(process.argv);
    if (args.step !== "reset") {
      const provider = new JsonRpcProvider(RPC_URL);
      const state = await readState(args.runId);
      if (state) {
        await sweepStateToFunder(provider, state);
      }
    }
  } catch (sweepErr) {
    console.error("Sim flow sweep failed:", sweepErr);
  }
  process.exit(1);
});
