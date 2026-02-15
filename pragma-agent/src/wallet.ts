import { JsonRpcProvider, Wallet, Contract, formatUnits, formatEther } from "ethers";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  RPC_URL,
  USDC_ADDRESS,
  USDC_DECIMALS,
  ERC20_ABI,
  AGENT_SMART_ACCOUNT_ABI,
} from "./config.js";

// ─── Wallet file management ──────────────────────────────────────────────────

const WALLET_DIR = path.join(os.homedir(), ".openclaw", "pragma-agent");
const DEFAULT_WALLET_FILE = "wallet.json";
const WALLET_SUBDIR = "wallets";

/**
 * Get the full path for a wallet file.
 */
function resolveWalletPath(filenameOrPath: string): string {
  let p = filenameOrPath;
  if (p.startsWith("~")) {
    p = path.join(os.homedir(), p.slice(1));
  }
  if (path.isAbsolute(p)) return p;
  return path.join(WALLET_DIR, p);
}

function sanitizeSessionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function inferSessionIdFromSessionKey(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.match(/(?:^|:)agent:([^:]+)/);
  if (!m || !m[1]) return null;
  return m[1];
}

function inferSessionIdFromCwd(cwd: string): string | null {
  // bot2 workspace pattern: ~/.openclaw/workspaces/<agentId>
  const m = cwd.match(/\/\.openclaw\/workspaces\/([^/]+)/);
  if (m && m[1]) return m[1];

  // default main workspace pattern: ~/.openclaw/workspace
  if (cwd.includes("/.openclaw/workspace")) return "main";

  return null;
}

function getDefaultWalletPath(): string {
  const override = process.env.PRAGMA_WALLET_FILE;
  if (override && override.trim().length > 0) {
    return resolveWalletPath(override.trim());
  }

  const sessionIdCandidates = [
    process.env.PRAGMA_SESSION_ID,
    process.env.OPENCLAW_AGENT_ID,
    process.env.OPENCLAW_AGENT,
    inferSessionIdFromSessionKey(process.env.OPENCLAW_SESSION_KEY),
    process.env.OPENCLAW_SESSION_ID,
    process.env.OPENCLAW_SESSION,
    inferSessionIdFromCwd(process.cwd()),
  ];

  const sessionId = sessionIdCandidates.find((v) => v && v.trim().length > 0);

  if (sessionId && sessionId.trim().length > 0) {
    const safe = sanitizeSessionId(sessionId.trim());
    return path.join(WALLET_DIR, WALLET_SUBDIR, `${safe}.json`);
  }

  return resolveWalletPath(DEFAULT_WALLET_FILE);
}

// Backward compatibility
const WALLET_FILE = getDefaultWalletPath();

interface Registration {
  agentId: string;
  smartAccount: string;
  poolAddress?: string;
  owner: string;
  registeredAt: string;
  txHashes: Record<string, string>;
  /** Whether agent needs investor funding (enables auto-split) */
  needsFunding?: boolean;
  /** Split ratio in basis points (e.g., 4000 = 40% to pool) */
  splitRatio?: number;
}

interface WalletData {
  privateKey: string;
  address: string;
  createdAt: string;
  registration: Registration | null;
}

/**
 * Load or create a wallet from a specific file.
 */
function loadOrCreateWalletByFile(filenameOrPath: string): WalletData {
  const walletPath = resolveWalletPath(filenameOrPath);
  if (fs.existsSync(walletPath)) {
    const raw = fs.readFileSync(walletPath, "utf-8");
    const data = JSON.parse(raw) as WalletData;
    // Handle legacy wallet files without registration field
    if (data.registration === undefined) {
      data.registration = null;
    }
    return data;
  }

  // First run: generate a new wallet
  const randomWallet = Wallet.createRandom();
  const data: WalletData = {
    privateKey: randomWallet.privateKey,
    address: randomWallet.address,
    createdAt: new Date().toISOString(),
    registration: null,
  };

  fs.mkdirSync(path.dirname(walletPath), { recursive: true });
  fs.writeFileSync(walletPath, JSON.stringify(data, null, 2), "utf-8");
  return data;
}

/**
 * Save registration data to a specific wallet file.
 */
function saveRegistrationByFile(filenameOrPath: string, reg: Registration): void {
  const data = loadOrCreateWalletByFile(filenameOrPath);
  data.registration = reg;
  const walletPath = resolveWalletPath(filenameOrPath);
  fs.writeFileSync(walletPath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Get registration data from a specific wallet file.
 */
function getRegistrationByFile(filenameOrPath: string): Registration | null {
  const data = loadOrCreateWalletByFile(filenameOrPath);
  return data.registration;
}

/**
 * Load or create the agent wallet. On first run, generates a random private key
 * and saves it to ~/.openclaw/pragma-agent/wallet.json. On subsequent runs,
 * loads from the saved file.
 */
function loadOrCreateWallet(): WalletData {
  return loadOrCreateWalletByFile(getDefaultWalletPath());
}

/**
 * Save registration data to the wallet file.
 */
function saveRegistration(reg: Registration): void {
  const data = loadOrCreateWallet();
  data.registration = reg;
  fs.writeFileSync(getDefaultWalletPath(), JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Get registration data, or null if not registered.
 */
function getRegistration(): Registration | null {
  const data = loadOrCreateWallet();
  return data.registration;
}

/**
 * Get registration data, throwing if not registered.
 */
function requireRegistration(): Registration {
  const reg = getRegistration();
  if (!reg) {
    throw new Error("Agent not registered. Call pragma-register first.");
  }
  return reg;
}

/**
 * Get a connected Wallet instance backed by the agent's private key.
 */
function getSignerWallet(rpcUrl?: string): Wallet {
  const data = loadOrCreateWallet();
  const provider = new JsonRpcProvider(rpcUrl ?? RPC_URL);
  return new Wallet(data.privateKey, provider);
}

// ─── Tool handler ────────────────────────────────────────────────────────────

export interface WalletInput {
  action: "getBalance" | "getAddress" | "getPolicy";
  /** Optional: address of an AgentSmartAccount (for getPolicy). Defaults to registered smart account. */
  smartAccountAddress?: string;
  /** Optional: override RPC URL */
  rpcUrl?: string;
}

export async function handleWallet(input: WalletInput): Promise<string> {
  try {
    const rpcUrl = input.rpcUrl ?? RPC_URL;
    const walletData = loadOrCreateWallet();

    switch (input.action) {
      case "getAddress": {
        const reg = walletData.registration;
        return JSON.stringify({
          eoaAddress: walletData.address,
          smartAccountAddress: reg?.smartAccount ?? null,
          agentId: reg?.agentId ?? null,
          poolAddress: reg?.poolAddress ?? null,
          registered: reg !== null,
          walletFile: WALLET_FILE,
          createdAt: walletData.createdAt,
        });
      }

      case "getBalance": {
        const provider = new JsonRpcProvider(rpcUrl);
        const eoaAddress = walletData.address;
        const reg = walletData.registration;

        // Always fetch EOA MON balance (native gas token)
        const monBalance = await provider.getBalance(eoaAddress);

        // Fetch USDC balance from smart account if registered, else EOA
        const balanceAddress = reg?.smartAccount ?? eoaAddress;
        const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
        const usdcBalance: bigint = await usdc.balanceOf(balanceAddress);

        const result: Record<string, unknown> = {
          registered: reg !== null,
          eoaAddress,
          nativeTokenSymbol: "MON",
          nativeBalance: formatEther(monBalance),
          nativeBalanceWei: monBalance.toString(),
          monBalance: formatEther(monBalance),
          monBalanceWei: monBalance.toString(),
          usdcAddress: balanceAddress,
          usdcBalance: formatUnits(usdcBalance, USDC_DECIMALS),
          usdcBalanceRaw: usdcBalance.toString(),
        };

        if (reg) {
          result.smartAccountAddress = reg.smartAccount;
          result.agentId = reg.agentId;
          result.poolAddress = reg.poolAddress;

          // Also fetch EOA USDC balance for comparison
          if (reg.smartAccount !== eoaAddress) {
            const eoaUsdcBalance: bigint = await usdc.balanceOf(eoaAddress);
            result.eoaUsdcBalance = formatUnits(eoaUsdcBalance, USDC_DECIMALS);
            result.eoaUsdcBalanceRaw = eoaUsdcBalance.toString();
          }
        }

        return JSON.stringify(result);
      }

      case "getPolicy": {
        const reg = walletData.registration;
        const accountAddr = input.smartAccountAddress ?? reg?.smartAccount;
        if (!accountAddr) {
          return JSON.stringify({
            error:
              "smartAccountAddress is required for getPolicy action. Register first with pragma-register, or provide the address of an AgentSmartAccount.",
          });
        }

        const provider = new JsonRpcProvider(rpcUrl);
        const account = new Contract(accountAddr, AGENT_SMART_ACCOUNT_ABI, provider);

        const [policy, dailySpend, owner, operator, agentId] = await Promise.all([
          account.getPolicy(),
          account.getDailySpend(),
          account.owner(),
          account.operator(),
          account.agentId(),
        ]);

        return JSON.stringify({
          smartAccountAddress: accountAddr,
          owner: owner as string,
          operator: operator as string,
          agentId: agentId as string,
          policy: {
            dailyLimit: formatUnits(policy.dailyLimit, USDC_DECIMALS),
            dailyLimitRaw: policy.dailyLimit.toString(),
            expiresAt: Number(policy.expiresAt),
            expiresAtDate: new Date(Number(policy.expiresAt) * 1000).toISOString(),
            requiresApprovalAbove: formatUnits(policy.requiresApprovalAbove, USDC_DECIMALS),
            requiresApprovalAboveRaw: policy.requiresApprovalAbove.toString(),
          },
          dailySpend: {
            amount: formatUnits(dailySpend.amount, USDC_DECIMALS),
            amountRaw: dailySpend.amount.toString(),
            lastReset: Number(dailySpend.lastReset),
            lastResetDate: new Date(Number(dailySpend.lastReset) * 1000).toISOString(),
          },
        });
      }

      default:
        return JSON.stringify({
          error: `Unknown action: ${input.action}. Valid actions: getBalance, getAddress, getPolicy`,
        });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message });
  }
}

// ─── Tool schema ─────────────────────────────────────────────────────────────

export const walletSchema = {
  name: "pragma-wallet",
  description:
    "Manage the agent's PragmaMoney wallet on Monad Testnet. Get wallet address (EOA + smart account), check MON/USDC balances, or read an AgentSmartAccount spending policy.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string" as const,
        enum: ["getBalance", "getAddress", "getPolicy"],
        description: "The wallet action to perform.",
      },
      smartAccountAddress: {
        type: "string" as const,
        description:
          "Address of an AgentSmartAccount contract. Required for 'getPolicy' if not registered.",
      },
      rpcUrl: {
        type: "string" as const,
        description: "Override the default Monad Testnet RPC URL.",
      },
    },
    required: ["action"],
  },
};

export {
  getSignerWallet,
  loadOrCreateWallet,
  loadOrCreateWalletByFile,
  saveRegistration,
  saveRegistrationByFile,
  getRegistration,
  getRegistrationByFile,
  requireRegistration,
  resolveWalletPath,
  getDefaultWalletPath,
};
export type { Registration, WalletData };
