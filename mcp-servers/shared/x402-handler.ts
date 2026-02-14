import { ethers } from "ethers";

const GATEWAY_ABI = [
  "function verifyPayment(bytes32 paymentId) view returns (bool valid, address payer, uint256 amount)",
];

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
      process.env.GATEWAY_ADDRESS ||
      "0x8887dD91C983b2c647a41DEce32c34E79c7C33df";

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

export function isPaymentUsed(paymentId: string): boolean {
  return usedPaymentIds.has(paymentId);
}

export function clearPaymentCache() {
  usedPaymentIds.clear();
}
