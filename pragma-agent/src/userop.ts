/**
 * userop.ts — 4337 UserOperation client for AgentSmartAccount
 *
 * Uses a raw bundler RPC (Alchemy) + viem to build, sign, and send
 * UserOperations through a pre-deployed AgentSmartAccount on Monad Testnet.
 *
 * EntryPoint v0.7 | Chain 10143 | Alchemy bundler
 */

import {
  createPublicClient,
  http,
  encodeFunctionData,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getUserOperationHash } from "viem/account-abstraction";

import {
  CHAIN_ID,
  ENTRYPOINT_ADDRESS,
  BUNDLER_URL,
  RPC_URL,
  X402_GATEWAY_ADDRESS,
  SERVICE_REGISTRY_ADDRESS,
} from "./config.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Call {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}

export interface UserOpResult {
  txHash: string;
  userOpHash: string;
  success: boolean;
}

interface PendingUserOpInfo {
  nonce: bigint;
  userOpHash: string;
}

const pendingUserOpsBySender = new Map<string, PendingUserOpInfo>();

/** EntryPoint v0.7 UserOperation struct */
interface UserOperationV07 {
  sender: Address;
  nonce: bigint;
  factory: Address | undefined;
  factoryData: Hex | undefined;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster: Address | undefined;
  paymasterVerificationGasLimit: bigint | undefined;
  paymasterPostOpGasLimit: bigint | undefined;
  paymasterData: Hex | undefined;
  signature: Hex;
}

// ─── Viem-format ABIs (local to this file) ──────────────────────────────────

const ERC20_ABI_VIEM = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const FUSDC_ABI_VIEM = [
  {
    inputs: [
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "mint",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const GATEWAY_ABI_VIEM = [
  {
    inputs: [
      { name: "serviceId", type: "bytes32" },
      { name: "calls", type: "uint256" },
    ],
    name: "payForService",
    outputs: [{ name: "paymentId", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const UNIVERSAL_ROUTER_ABI_VIEM = [
  {
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const;

const SUPER_REAL_FAKE_USDC_ABI_VIEM = [
  {
    inputs: [{ name: "amount", type: "uint256" }],
    name: "upgrade",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const POOL_ABI_VIEM = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "assets", type: "uint256" },
    ],
    name: "pull",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    name: "deposit",
    outputs: [{ name: "shares", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const SERVICE_REGISTRY_ABI_VIEM = [
  {
    inputs: [
      { name: "serviceId", type: "bytes32" },
      { name: "agentId", type: "uint256" },
      { name: "name", type: "string" },
      { name: "pricePerCall", type: "uint256" },
      { name: "endpoint", type: "string" },
      { name: "serviceType", type: "uint8" },
      { name: "paymentMode", type: "uint8" },
    ],
    name: "registerService",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const REPUTATION_REPORTER_ABI_VIEM = [
  {
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "value", type: "int128" },
      { name: "valueDecimals", type: "uint8" },
      { name: "tag1", type: "string" },
      { name: "tag2", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "feedbackURI", type: "string" },
      { name: "feedbackHash", type: "bytes32" },
    ],
    name: "giveFeedback",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const SMART_ACCOUNT_ABI_VIEM = [
  {
    inputs: [
      { name: "dest", type: "address" },
      { name: "value", type: "uint256" },
      { name: "func", type: "bytes" },
    ],
    name: "execute",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "dest", type: "address[]" },
      { name: "values", type: "uint256[]" },
      { name: "func", type: "bytes[]" },
    ],
    name: "executeBatch",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const ENTRYPOINT_ABI_VIEM = [
  {
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    name: "getNonce",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ─── Hex helpers ────────────────────────────────────────────────────────────

function bigintToHex(n: bigint): Hex {
  return `0x${n.toString(16)}` as Hex;
}

function hexifyUserOp(
  op: UserOperationV07
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {
    sender: op.sender,
    nonce: bigintToHex(op.nonce),
    callData: op.callData,
    callGasLimit: bigintToHex(op.callGasLimit),
    verificationGasLimit: bigintToHex(op.verificationGasLimit),
    preVerificationGas: bigintToHex(op.preVerificationGas),
    maxFeePerGas: bigintToHex(op.maxFeePerGas),
    maxPriorityFeePerGas: bigintToHex(op.maxPriorityFeePerGas),
    signature: op.signature,
  };

  // v0.7: only include factory/paymaster fields when present
  if (op.factory) {
    result.factory = op.factory;
    result.factoryData = op.factoryData ?? "0x";
  }
  if (op.paymaster) {
    result.paymaster = op.paymaster;
    result.paymasterVerificationGasLimit = bigintToHex(op.paymasterVerificationGasLimit ?? 0n);
    result.paymasterPostOpGasLimit = bigintToHex(op.paymasterPostOpGasLimit ?? 0n);
    result.paymasterData = op.paymasterData ?? "0x";
  }

  return result;
}

// ─── Core: sendUserOp ───────────────────────────────────────────────────────

/**
 * Build, sponsor, sign, and submit a UserOperation for an AgentSmartAccount.
 *
 * @param smartAccountAddress - The deployed AgentSmartAccount address
 * @param operatorPrivateKey - Hex private key of the operator EOA (signs UserOps)
 * @param calls - One or more calls to execute through the smart account
 * @returns UserOpResult with txHash, userOpHash, and success flag
 */
export async function sendUserOp(
  smartAccountAddress: `0x${string}`,
  operatorPrivateKey: `0x${string}`,
  calls: Call[],
  options?: { skipSponsorship?: boolean }
): Promise<UserOpResult> {
  if (!BUNDLER_URL) {
    throw new Error(
      "BUNDLER_URL not set. Cannot send UserOperations without a bundler."
    );
  }

  if (calls.length === 0) {
    throw new Error("At least one call is required.");
  }

  // 1. Create viem account from operator private key
  const operatorAccount = privateKeyToAccount(operatorPrivateKey);

  // 2. Public client for on-chain reads (nonce from EntryPoint)
  const publicClient = createPublicClient({
    transport: http(RPC_URL),
  });

  // 4. Encode callData for the smart account
  let callData: Hex;
  if (calls.length === 1) {
    const c = calls[0];
    callData = encodeFunctionData({
      abi: SMART_ACCOUNT_ABI_VIEM,
      functionName: "execute",
      args: [c.to, c.value, c.data],
    });
  } else {
    const dests = calls.map((c) => c.to);
    const values = calls.map((c) => c.value);
    const datas = calls.map((c) => c.data);
    callData = encodeFunctionData({
      abi: SMART_ACCOUNT_ABI_VIEM,
      functionName: "executeBatch",
      args: [dests, values, datas],
    });
  }

  // 5. Get nonce from EntryPoint
  const nonce = await publicClient.readContract({
    address: ENTRYPOINT_ADDRESS as Address,
    abi: ENTRYPOINT_ABI_VIEM,
    functionName: "getNonce",
    args: [smartAccountAddress, 0n],
  });

  // 6. Get gas prices from RPC (Alchemy bundler does not provide Pimlico helpers)
  const gasPrice = await publicClient.getGasPrice();
  const maxFeePerGas = gasPrice * 2n; // 2x base fee for reliability
  let maxPriorityFeePerGas = 3_000_000_000n; // 3 gwei tip
  if (maxPriorityFeePerGas > maxFeePerGas) {
    maxPriorityFeePerGas = maxFeePerGas;
  }

  // 7. Build the unsigned UserOp (dummy signature for estimation)
  //    The smart account expects raw ECDSA signature (65 bytes)
  const dummySignature =
    "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c" as Hex;

  const unsignedUserOp: UserOperationV07 = {
    sender: smartAccountAddress,
    nonce: nonce as bigint,
    factory: undefined,
    factoryData: undefined,
    callData,
    callGasLimit: 0n,
    verificationGasLimit: 0n,
    preVerificationGas: 0n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster: undefined,
    paymasterVerificationGasLimit: undefined,
    paymasterPostOpGasLimit: undefined,
    paymasterData: undefined,
    signature: dummySignature,
  };

  // 8. Self-pay only: estimate gas via bundler, no paymaster
  const gasEstimate = await bundlerRpc<{
    callGasLimit: string;
    verificationGasLimit: string;
    preVerificationGas: string;
  }>("eth_estimateUserOperationGas", [
    hexifyUserOp(unsignedUserOp),
    ENTRYPOINT_ADDRESS,
  ]);

  const sponsoredUserOp: UserOperationV07 = {
    ...unsignedUserOp,
    callGasLimit: BigInt(gasEstimate.callGasLimit) * 2n,
    verificationGasLimit: BigInt(gasEstimate.verificationGasLimit) * 2n,
    preVerificationGas: BigInt(gasEstimate.preVerificationGas) * 2n,
    paymaster: undefined,
    paymasterVerificationGasLimit: undefined,
    paymasterPostOpGasLimit: undefined,
    paymasterData: undefined,
  };

  const signAndSend = async (op: UserOperationV07): Promise<string> => {
    const opHash = getUserOperationHash({
      chainId: CHAIN_ID,
      entryPointAddress: ENTRYPOINT_ADDRESS as Address,
      entryPointVersion: "0.7",
      userOperation: {
        sender: op.sender,
        nonce: op.nonce,
        factory: op.factory,
        factoryData: op.factoryData,
        callData: op.callData,
        callGasLimit: op.callGasLimit,
        verificationGasLimit: op.verificationGasLimit,
        preVerificationGas: op.preVerificationGas,
        maxFeePerGas: op.maxFeePerGas,
        maxPriorityFeePerGas: op.maxPriorityFeePerGas,
        paymaster: op.paymaster,
        paymasterVerificationGasLimit: op.paymasterVerificationGasLimit,
        paymasterPostOpGasLimit: op.paymasterPostOpGasLimit,
        paymasterData: op.paymasterData,
        signature: op.signature,
      },
    });

    const rawSignature = await operatorAccount.signMessage({
      message: { raw: opHash as Hex },
    });
    op.signature = rawSignature;

    return await bundlerRpc<string>("eth_sendUserOperation", [
      hexifyUserOp(op),
      ENTRYPOINT_ADDRESS,
    ]);
  };

  const senderKey = smartAccountAddress.toLowerCase();
  const pending = pendingUserOpsBySender.get(senderKey);
  if (pending && pending.nonce === (nonce as bigint)) {
    const maybeReceipt = await bundlerRpc<BundlerReceipt | null>(
      "eth_getUserOperationReceipt",
      [pending.userOpHash]
    ).catch(() => null);
    if (!maybeReceipt) {
      throw new Error(
        `Pending UserOp exists for sender ${smartAccountAddress} nonce ${pending.nonce.toString()}. ` +
          "Wait for it to be mined or dropped before sending another."
      );
    }
    pendingUserOpsBySender.delete(senderKey);
  }

  let sendResult: string;
  try {
    sendResult = await signAndSend(sponsoredUserOp);
  } catch (err) {
    const msg = (err as Error | undefined)?.message || "";
    if (!msg.includes("replacement underpriced")) {
      throw err;
    }
    const bump = 22n; // 2.2x
    const bumped: UserOperationV07 = {
      ...sponsoredUserOp,
      maxFeePerGas: (sponsoredUserOp.maxFeePerGas * bump) / 10n,
      maxPriorityFeePerGas: (sponsoredUserOp.maxPriorityFeePerGas * bump) / 10n,
      signature: sponsoredUserOp.signature,
    };
    if (bumped.maxPriorityFeePerGas > bumped.maxFeePerGas) {
      bumped.maxPriorityFeePerGas = bumped.maxFeePerGas;
    }
    sendResult = await signAndSend(bumped);
  }

  pendingUserOpsBySender.set(senderKey, {
    nonce: nonce as bigint,
    userOpHash: sendResult,
  });

  // 12. Poll for receipt
  const receipt = await pollForReceipt(
    sendResult,
    Number(process.env.UO_RECEIPT_TIMEOUT_MS || "180000")
  );
  pendingUserOpsBySender.delete(senderKey);

  return {
    txHash: receipt.receipt.transactionHash,
    userOpHash: sendResult,
    success: receipt.success,
  };
}

// ─── Raw bundler JSON-RPC helper ────────────────────────────────────────────

/**
 * Send a raw JSON-RPC request to the Pimlico bundler endpoint.
 * This avoids fighting viem's strict EIP-1193 types for bundler-specific methods.
 */
async function bundlerRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  const json = (await res.json()) as {
    result?: T;
    error?: { code: number; message: string };
  };

  if (json.error) {
    throw new Error(`Bundler RPC error (${method}): ${json.error.message}`);
  }

  return json.result as T;
}

// ─── Receipt polling ────────────────────────────────────────────────────────

interface BundlerReceipt {
  success: boolean;
  receipt: {
    transactionHash: string;
    blockNumber: string;
  };
  reason?: string;
}

async function pollForReceipt(
  userOpHash: string,
  timeoutMs: number
): Promise<BundlerReceipt> {
  const start = Date.now();
  const interval = 2000; // poll every 2 seconds

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await bundlerRpc<BundlerReceipt | null>(
        "eth_getUserOperationReceipt",
        [userOpHash]
      );

      if (result) {
        return result;
      }
    } catch {
      // Receipt not available yet, keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(
    `Timed out waiting for UserOperation receipt after ${timeoutMs}ms. UserOpHash: ${userOpHash}`
  );
}

// ─── Call builders ──────────────────────────────────────────────────────────

/**
 * Build an ERC-20 approve call.
 */
export function buildApproveCall(
  token: `0x${string}`,
  spender: `0x${string}`,
  amount: bigint
): Call {
  return {
    to: token,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_ABI_VIEM,
      functionName: "approve",
      args: [spender, amount],
    }),
  };
}

/**
 * Build a mint call (for FUSDC or other mintable tokens).
 */
export function buildMintCall(
  token: `0x${string}`,
  to: `0x${string}`,
  amount: bigint
): Call {
  return {
    to: token,
    value: 0n,
    data: encodeFunctionData({
      abi: FUSDC_ABI_VIEM,
      functionName: "mint",
      args: [to, amount],
    }),
  };
}

/**
 * Build a Uniswap Universal Router execute call.
 */
export function buildUniversalRouterExecuteCall(
  router: `0x${string}`,
  commands: `0x${string}`,
  inputs: `0x${string}`[],
  deadline?: bigint
): Call {
  return {
    to: router,
    value: 0n,
    data: encodeFunctionData({
      abi: UNIVERSAL_ROUTER_ABI_VIEM,
      functionName: "execute",
      args: deadline !== undefined ? [commands, inputs, deadline] : [commands, inputs],
    }),
  };
}

/**
 * Build upgrade call for Super Real Fake USDC.
 */
export function buildUpgradeCall(
  token: `0x${string}`,
  amount: bigint
): Call {
  return {
    to: token,
    value: 0n,
    data: encodeFunctionData({
      abi: SUPER_REAL_FAKE_USDC_ABI_VIEM,
      functionName: "upgrade",
      args: [amount],
    }),
  };
}

/**
 * Build a gateway payForService call.
 * The smart account must have approved the gateway to spend USDC first.
 */
export function buildPayForServiceCall(
  serviceId: `0x${string}`,
  calls: bigint
): Call {
  return {
    to: X402_GATEWAY_ADDRESS as `0x${string}`,
    value: 0n,
    data: encodeFunctionData({
      abi: GATEWAY_ABI_VIEM,
      functionName: "payForService",
      args: [serviceId, calls],
    }),
  };
}

/**
 * Build a pool pull call (agent withdraws from its AgentPool).
 */
export function buildPoolPullCall(
  poolAddress: `0x${string}`,
  to: `0x${string}`,
  amount: bigint
): Call {
  return {
    to: poolAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: POOL_ABI_VIEM,
      functionName: "pull",
      args: [to, amount],
    }),
  };
}

/**
 * Build a ServiceRegistry.registerService call.
 * @param paymentMode - 0 for PROXY_WRAPPED (proxy handles payment), 1 for NATIVE_X402 (service handles payment)
 */
export function buildRegisterServiceCall(
  serviceId: `0x${string}`,
  agentId: bigint,
  name: string,
  pricePerCall: bigint,
  endpoint: string,
  serviceType: number,
  paymentMode: number = 0 // Default to PROXY_WRAPPED
): Call {
  return {
    to: SERVICE_REGISTRY_ADDRESS as `0x${string}`,
    value: 0n,
    data: encodeFunctionData({
      abi: SERVICE_REGISTRY_ABI_VIEM,
      functionName: "registerService",
      args: [serviceId, agentId, name, pricePerCall, endpoint, serviceType, paymentMode],
    }),
  };
}

/**
 * Build a pool deposit call (ERC-4626 deposit into an AgentPool).
 */
export function buildPoolDepositCall(
  poolAddress: `0x${string}`,
  assets: bigint,
  receiver: `0x${string}`
): Call {
  return {
    to: poolAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: POOL_ABI_VIEM,
      functionName: "deposit",
      args: [assets, receiver],
    }),
  };
}

/**
 * Build a ReputationReporter.giveFeedback call.
 */
export function buildReputationFeedbackCall(
  reporter: `0x${string}`,
  agentId: bigint,
  value: bigint,
  valueDecimals: number,
  tag1: string,
  tag2: string,
  endpoint: string,
  feedbackURI: string,
  feedbackHash: `0x${string}`
): Call {
  return {
    to: reporter,
    value: 0n,
    data: encodeFunctionData({
      abi: REPUTATION_REPORTER_ABI_VIEM,
      functionName: "giveFeedback",
      args: [
        agentId,
        value,
        valueDecimals,
        tag1,
        tag2,
        endpoint,
        feedbackURI,
        feedbackHash,
      ],
    }),
  };
}
