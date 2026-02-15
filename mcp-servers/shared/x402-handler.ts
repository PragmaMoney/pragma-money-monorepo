import { ethers } from "ethers";

const GATEWAY_ABI = [
  "function verifyPayment(bytes32 paymentId) view returns (bool valid, address payer, uint256 amount)",
];

// Monad Facilitator URL for x402 v2
const FACILITATOR_URL = "https://x402-facilitator.molandak.org";

// Default gateway address on Monad Testnet
const DEFAULT_GATEWAY_ADDRESS = "0x76f3a9aE46D58761f073a8686Eb60194B1917E27";

// Cache of used payment IDs (prevent replay)
const usedPaymentIds = new Set<string>();

// Provider singleton
let provider: ethers.JsonRpcProvider | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    const rpcUrl = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
    provider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return provider;
}

/**
 * Decode PAYMENT-SIGNATURE header (base64 or raw JSON)
 */
function decodePaymentSignature(paymentSignature: string): unknown {
  // Try base64 first
  try {
    const decoded = Buffer.from(paymentSignature, "base64").toString("utf-8");
    return JSON.parse(decoded);
  } catch {
    // Fall back to raw JSON
    try {
      return JSON.parse(paymentSignature);
    } catch {
      throw new Error("Invalid PAYMENT-SIGNATURE format");
    }
  }
}

/**
 * Verify a payment signature via the Monad facilitator's /verify endpoint.
 * This checks if the signature is valid without settling the payment.
 */
export async function verifyPaymentSignature(
  paymentSignature: string
): Promise<{ isValid: boolean; payload: unknown }> {
  try {
    const paymentData = decodePaymentSignature(paymentSignature);

    const response = await fetch(`${FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paymentData),
    });

    const data = await response.json();

    return {
      isValid: data.isValid === true,
      payload: paymentData,
    };
  } catch (error) {
    console.error(`[x402] Verify signature failed:`, error);
    return { isValid: false, payload: null };
  }
}

/**
 * Settle a payment via the Monad facilitator's /settle endpoint.
 * This executes the payment on-chain (facilitator pays gas).
 */
export async function settlePayment(paymentSignature: string): Promise<{
  success: boolean;
  transaction?: string;
  error?: string;
}> {
  try {
    const paymentData = decodePaymentSignature(paymentSignature);

    const response = await fetch(`${FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paymentData),
    });

    const responseText = await response.text();
    let settleResult: {
      success?: boolean;
      errorReason?: string;
      error?: string;
      transaction?: string;
    };

    try {
      settleResult = JSON.parse(responseText);
    } catch {
      return {
        success: false,
        error: `Facilitator error: ${responseText.slice(0, 200)}`,
      };
    }

    if (!settleResult.success) {
      return {
        success: false,
        error: settleResult.errorReason || settleResult.error || "Settlement failed",
      };
    }

    return {
      success: true,
      transaction: settleResult.transaction,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Settlement error";
    console.error(`[x402] Settlement failed:`, error);
    return { success: false, error: message };
  }
}

/**
 * Verify and settle a payment via the facilitator (x402 v2 flow).
 * This is the main entry point for PAYMENT-SIGNATURE header verification.
 */
export async function verifyAndSettlePayment(paymentSignature: string): Promise<{
  success: boolean;
  transaction?: string;
  error?: string;
}> {
  // First verify the signature
  const verifyResult = await verifyPaymentSignature(paymentSignature);
  if (!verifyResult.isValid) {
    return { success: false, error: "Invalid payment signature" };
  }

  // Then settle the payment
  return settlePayment(paymentSignature);
}

/**
 * Verify payment on-chain via x402Gateway (legacy x-payment-id flow).
 * This is the fallback for x402 v1 payments.
 */
export async function verifyPayment(
  paymentId: string,
  requiredAmount: bigint
): Promise<boolean> {
  // Check replay protection
  if (usedPaymentIds.has(paymentId)) {
    console.log(`[x402] Payment ${paymentId} already used`);
    return false;
  }

  try {
    const gatewayAddress =
      process.env.GATEWAY_ADDRESS || DEFAULT_GATEWAY_ADDRESS;

    const gateway = new ethers.Contract(
      gatewayAddress,
      GATEWAY_ABI,
      getProvider()
    );

    const [valid, payer, amount] = await gateway.verifyPayment(paymentId);

    // Check if payment is valid
    if (!valid) {
      console.log(`[x402] Payment ${paymentId} is not valid on-chain`);
      return false;
    }

    // Verify payment amount
    if (BigInt(amount) < requiredAmount) {
      console.log(
        `[x402] Insufficient payment: ${amount} < ${requiredAmount}`
      );
      return false;
    }

    // Mark as used
    usedPaymentIds.add(paymentId);

    console.log(`[x402] Payment verified: ${paymentId} from ${payer} for ${amount}`);
    return true;
  } catch (error) {
    console.error(`[x402] Verification failed:`, error);
    return false;
  }
}

/**
 * Check if a payment ID has already been used (replay protection).
 */
export function isPaymentUsed(paymentId: string): boolean {
  return usedPaymentIds.has(paymentId);
}

/**
 * Clear the payment cache (mainly for testing).
 */
export function clearPaymentCache() {
  usedPaymentIds.clear();
}

/**
 * Generate a PAYMENT-RESPONSE header value for successful payments.
 */
export function generatePaymentResponse(transaction?: string): string {
  const response = {
    success: true,
    ...(transaction && { transaction }),
  };
  return Buffer.from(JSON.stringify(response)).toString("base64");
}
