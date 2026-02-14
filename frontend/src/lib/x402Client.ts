import { WalletClient } from "viem";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { x402Client } from "@x402/core/client";

export const PROXY_URL = process.env.NEXT_PUBLIC_PROXY_URL || "http://localhost:4402";

// Monad Testnet configuration
const MONAD_NETWORK = "eip155:10143" as const;

export interface X402ClientOptions {
  walletClient: WalletClient;
}

/**
 * Creates a fetch wrapper with x402 payment capability for Monad.
 * When a request returns 402, it automatically:
 * 1. Parses payment requirements from the response
 * 2. Signs an EIP-3009 authorization with the wallet
 * 3. Retries the request with payment header
 */
export function createX402PaymentFetch(options: X402ClientOptions): typeof fetch {
  const { walletClient } = options;

  if (!walletClient.account) {
    throw new Error("Wallet client must have an account");
  }

  // Create EVM signer compatible with x402 ClientEvmSigner interface
  const evmSigner = {
    address: walletClient.account.address,
    signTypedData: async (message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => {
      return walletClient.signTypedData({
        account: walletClient.account!,
        domain: message.domain as Parameters<typeof walletClient.signTypedData>[0]["domain"],
        types: message.types as Parameters<typeof walletClient.signTypedData>[0]["types"],
        primaryType: message.primaryType,
        message: message.message,
      });
    },
  };

  // Create the Exact EVM scheme for signing
  const exactScheme = new ExactEvmScheme(evmSigner);

  // Create x402 client and register the Monad network
  const client = new x402Client().register(MONAD_NETWORK, exactScheme);

  console.log("[x402Client] Configured for network:", MONAD_NETWORK);

  // Wrap fetch with x402 payment capability
  return wrapFetchWithPayment(fetch, client);
}
