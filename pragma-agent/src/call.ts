import { Contract, formatUnits, JsonRpcProvider } from "ethers";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex, type Hex } from "viem";
import {
  RPC_URL,
  USDC_ADDRESS,
  USDC_DECIMALS,
  X402_GATEWAY_ADDRESS,
  X402_GATEWAY_ABI,
  ERC20_ABI,
  SERVICE_REGISTRY_ADDRESS,
  SERVICE_REGISTRY_ABI,
  DEFAULT_PROXY_URL,
  CHAIN_ID,
} from "./config.js";
import { loadOrCreateWallet, requireRegistration } from "./wallet.js";
import { sendUserOp, buildApproveCall, buildPayForServiceCall } from "./userop.js";

// ─── x402 Facilitator Constants ─────────────────────────────────────────────

const MONAD_NETWORK = "eip155:10143" as const;

// EIP-712 domain for Monad USDC TransferWithAuthorization
const USDC_DOMAIN = {
  name: "USDC",
  version: "2",
  chainId: BigInt(CHAIN_ID),
  verifyingContract: USDC_ADDRESS as `0x${string}`,
} as const;

// EIP-712 types for TransferWithAuthorization (ERC-3009)
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// ─── x402 Payment Requirements Type ─────────────────────────────────────────

interface X402PaymentRequired {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
    extra?: { name: string; version: string };
  }>;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
}

// ─── Facilitator Flow Handler ────────────────────────────────────────────────

async function handleFacilitatorCall(
  input: CallInput,
  proxyUrl: string,
  method: string
): Promise<string> {
  const walletData = loadOrCreateWallet();
  const account = privateKeyToAccount(walletData.privateKey as `0x${string}`);
  // Use direct endpoint for NATIVE_X402 services, proxy for PROXY_WRAPPED
  const url = input.endpoint ?? `${proxyUrl}/proxy/${input.serviceId}`;

  // Step 1: Make initial request to get 402 with payment requirements
  const initialResponse = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" && input.body ? input.body : undefined,
  });

  // If not 402, the endpoint is free or already authenticated
  if (initialResponse.status !== 402) {
    const contentType = initialResponse.headers.get("content-type") ?? "";
    let responseBody: string;
    if (contentType.includes("application/json")) {
      const json = await initialResponse.json();
      responseBody = JSON.stringify(json);
    } else {
      responseBody = await initialResponse.text();
    }

    return JSON.stringify({
      success: true,
      action: "call",
      serviceId: input.serviceId,
      mode: "facilitator",
      note: "Endpoint did not require payment (not 402)",
      httpStatus: initialResponse.status,
      response: responseBody,
    });
  }

  // Step 2: Parse payment requirements from 402 response
  const paymentRequiredHeader = initialResponse.headers.get("PAYMENT-REQUIRED");
  if (!paymentRequiredHeader) {
    return JSON.stringify({
      error: "402 response missing PAYMENT-REQUIRED header",
    });
  }

  let paymentRequired: X402PaymentRequired;
  try {
    const decoded = Buffer.from(paymentRequiredHeader, "base64").toString("utf-8");
    paymentRequired = JSON.parse(decoded);
  } catch {
    // Try parsing as raw JSON
    try {
      paymentRequired = JSON.parse(paymentRequiredHeader);
    } catch {
      return JSON.stringify({
        error: "Failed to parse PAYMENT-REQUIRED header",
      });
    }
  }

  if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
    return JSON.stringify({
      error: "No payment options in PAYMENT-REQUIRED",
    });
  }

  const accepted = paymentRequired.accepts[0];

  // Step 3: Build TransferWithAuthorization message
  const now = Math.floor(Date.now() / 1000);
  const nonce = keccak256(toHex(Math.random().toString())) as Hex;

  const authorization = {
    from: account.address,
    to: accepted.payTo as `0x${string}`,
    value: BigInt(accepted.amount),
    validAfter: BigInt(now - 60), // 60s in past for clock skew
    validBefore: BigInt(now + 900), // 15 minutes validity
    nonce,
  };

  // Step 4: Sign EIP-712 TransferWithAuthorization
  const signature = await account.signTypedData({
    domain: USDC_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });

  // Step 5: Build x402 v2 payload
  const x402Payload = {
    x402Version: 2,
    payload: {
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
      signature,
    },
    resource: paymentRequired.resource,
    accepted: accepted,
  };

  // Step 6: Send request with PAYMENT-SIGNATURE header
  const paymentSignature = Buffer.from(JSON.stringify(x402Payload)).toString("base64");

  const fetchHeaders: Record<string, string> = {
    "PAYMENT-SIGNATURE": paymentSignature,
    "Content-Type": "application/json",
    ...(input.headers ?? {}),
  };

  const fetchOptions: RequestInit = {
    method,
    headers: fetchHeaders,
  };

  if (method === "POST" && input.body) {
    fetchOptions.body = input.body;
  }

  const response = await fetch(url, fetchOptions);
  const responseStatus = response.status;

  // Parse response
  let responseBody: string;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await response.json();
    responseBody = JSON.stringify(json);
  } else {
    responseBody = await response.text();
  }

  // Check for payment response header
  const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE");
  let paymentResponse: { success?: boolean; transaction?: string } | null = null;
  if (paymentResponseHeader) {
    try {
      const decoded = Buffer.from(paymentResponseHeader, "base64").toString("utf-8");
      paymentResponse = JSON.parse(decoded);
    } catch {
      // Ignore parse errors
    }
  }

  if (responseStatus !== 200) {
    return JSON.stringify({
      error: `Request failed with status ${responseStatus}`,
      mode: "facilitator",
      httpStatus: responseStatus,
      response: responseBody,
      paymentResponse,
    });
  }

  return JSON.stringify({
    success: true,
    action: "call",
    serviceId: input.serviceId,
    mode: "facilitator",
    payer: account.address,
    payTo: accepted.payTo,
    amount: formatUnits(BigInt(accepted.amount), USDC_DECIMALS),
    network: accepted.network,
    proxyUrl: url,
    httpMethod: method,
    httpStatus: responseStatus,
    response: responseBody,
    paymentResponse,
  });
}

// ─── Tool handler ────────────────────────────────────────────────────────────

export interface CallInput {
  action: "call";
  /** The bytes32 serviceId to pay for and call. Required. */
  serviceId: string;
  /** HTTP method: GET or POST. Defaults to GET. */
  method?: string;
  /** Optional JSON body for POST requests. */
  body?: string;
  /** Number of calls to pay for. Defaults to 1. */
  calls?: number;
  /** Proxy base URL. Defaults to http://localhost:4402 */
  proxyUrl?: string;
  /** Direct endpoint URL for NATIVE_X402 services (bypasses proxy) */
  endpoint?: string;
  /** Optional: additional HTTP headers as a JSON object. */
  headers?: Record<string, string>;
  /** Optional: override RPC URL */
  rpcUrl?: string;
  /** Use x402 facilitator flow instead of 4337 UserOp (Path A vs Path B) */
  useFacilitator?: boolean;
}

export async function handleCall(input: CallInput): Promise<string> {
  try {
    if (input.action !== "call") {
      return JSON.stringify({
        error: `Unknown action: ${input.action}. This tool only supports the 'call' action.`,
      });
    }

    if (!input.serviceId) {
      return JSON.stringify({
        error: "serviceId is required for 'call' action.",
      });
    }

    const rpcUrl = input.rpcUrl ?? RPC_URL;
    const proxyUrl = input.proxyUrl ?? DEFAULT_PROXY_URL;
    const method = (input.method ?? "GET").toUpperCase();
    const calls = input.calls ?? 1;

    if (calls <= 0) {
      return JSON.stringify({ error: "calls must be a positive integer." });
    }

    // Route to facilitator flow if requested
    if (input.useFacilitator) {
      return handleFacilitatorCall(input, proxyUrl, method);
    }

    // Get registration (smart account) and wallet (operator private key)
    const registration = requireRegistration();
    const walletData = loadOrCreateWallet();

    // ── Step 1: Look up service to calculate cost ────────────────────────

    const provider = new JsonRpcProvider(rpcUrl);
    const registry = new Contract(SERVICE_REGISTRY_ADDRESS, SERVICE_REGISTRY_ABI, provider);
    const service = await registry.getService(input.serviceId);

    if (!service.active) {
      return JSON.stringify({
        error: `Service ${input.serviceId} is not active.`,
      });
    }

    const pricePerCall: bigint = service.pricePerCall;
    const totalCost = pricePerCall * BigInt(calls);

    // ── Step 2: Check balance on the smart account ─────────────────────

    const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
    const balance: bigint = await usdc.balanceOf(registration.smartAccount);

    if (balance < totalCost) {
      return JSON.stringify({
        error: `Insufficient USDC balance. Need ${formatUnits(totalCost, USDC_DECIMALS)} USDC but smart account has ${formatUnits(balance, USDC_DECIMALS)} USDC.`,
        required: formatUnits(totalCost, USDC_DECIMALS),
        available: formatUnits(balance, USDC_DECIMALS),
        smartAccount: registration.smartAccount,
      });
    }

    // ── Step 3: Approve + Pay via single UserOp batch ──────────────────

    const result = await sendUserOp(
      registration.smartAccount as `0x${string}`,
      walletData.privateKey as `0x${string}`,
      [
        buildApproveCall(
          USDC_ADDRESS as `0x${string}`,
          X402_GATEWAY_ADDRESS as `0x${string}`,
          totalCost
        ),
        buildPayForServiceCall(
          input.serviceId as `0x${string}`,
          BigInt(calls)
        ),
      ]
    );

    if (!result.success) {
      return JSON.stringify({
        error: "UserOp failed on-chain.",
        txHash: result.txHash,
        userOpHash: result.userOpHash,
      });
    }

    // ── Step 4: Extract paymentId from the transaction receipt ──────────

    let paymentId: string | null = null;
    const txReceipt = await provider.getTransactionReceipt(result.txHash);
    if (txReceipt) {
      const gateway = new Contract(X402_GATEWAY_ADDRESS, X402_GATEWAY_ABI, provider);
      for (const log of txReceipt.logs) {
        try {
          const parsed = gateway.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          if (parsed && parsed.name === "ServicePaid") {
            paymentId = parsed.args.paymentId;
            break;
          }
        } catch {
          // Not a gateway event, skip
        }
      }
    }

    if (!paymentId) {
      return JSON.stringify({
        error: "Payment UserOp succeeded but could not extract paymentId from event logs.",
        txHash: result.txHash,
        userOpHash: result.userOpHash,
      });
    }

    // ── Step 5: Call the proxy with x-payment-id header ────────────────

    const url = `${proxyUrl}/proxy/${input.serviceId}`;
    const fetchHeaders: Record<string, string> = {
      "x-payment-id": paymentId,
      "Content-Type": "application/json",
      ...(input.headers ?? {}),
    };

    const fetchOptions: RequestInit = {
      method,
      headers: fetchHeaders,
    };

    if (method === "POST" && input.body) {
      fetchOptions.body = input.body;
    }

    const response = await fetch(url, fetchOptions);
    const responseStatus = response.status;

    let responseBody: string;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = await response.json();
      responseBody = JSON.stringify(json);
    } else {
      responseBody = await response.text();
    }

    return JSON.stringify({
      success: true,
      action: "call",
      serviceId: input.serviceId,
      serviceName: service.name as string,
      paymentId,
      calls,
      totalCost: formatUnits(totalCost, USDC_DECIMALS),
      txHash: result.txHash,
      userOpHash: result.userOpHash,
      payer: registration.smartAccount,
      proxyUrl: url,
      httpMethod: method,
      httpStatus: responseStatus,
      response: responseBody,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message });
  }
}

// ─── Tool schema ─────────────────────────────────────────────────────────────

export const callSchema = {
  name: "pragma-call",
  description:
    "One-step pay-and-call via 4337 UserOperation: approves USDC and pays for service through the AgentSmartAccount, then makes an HTTP request to the proxy with the paymentId. Returns the API response.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string" as const,
        enum: ["call"],
        description: "Must be 'call'. This tool performs a combined pay + HTTP call.",
      },
      serviceId: {
        type: "string" as const,
        description:
          "The bytes32 service identifier to pay for and call. Required.",
      },
      method: {
        type: "string" as const,
        enum: ["GET", "POST"],
        description: "HTTP method for the proxy call. Defaults to 'GET'.",
      },
      body: {
        type: "string" as const,
        description:
          "JSON body for POST requests. Must be a valid JSON string.",
      },
      calls: {
        type: "number" as const,
        description: "Number of API calls to pay for. Defaults to 1.",
      },
      proxyUrl: {
        type: "string" as const,
        description:
          "Base URL of the PragmaMoney proxy. Defaults to 'http://localhost:4402'.",
      },
      headers: {
        type: "object" as const,
        description: "Additional HTTP headers to send with the proxy request.",
      },
      rpcUrl: {
        type: "string" as const,
        description: "Override the default Monad Testnet RPC URL.",
      },
    },
    required: ["action", "serviceId"],
  },
};
