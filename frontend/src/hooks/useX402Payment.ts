"use client";

import { useState, useMemo, useCallback } from "react";
import { useWalletClient, useAccount } from "wagmi";
import { createX402PaymentFetch, PROXY_URL } from "@/lib/x402Client";
import { FundingModel } from "@/types";

export function useX402Payment() {
  const { isConnected } = useAccount();
  const { data: walletClient, isLoading: walletLoading } = useWalletClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const paymentFetch = useMemo(() => {
    if (!walletClient || !walletClient.account) return null;
    try {
      return createX402PaymentFetch({ walletClient });
    } catch (err) {
      console.error("[useX402Payment] Failed to create payment fetch:", err);
      return null;
    }
  }, [walletClient]);

  /**
   * Make a paid request.
   * @param resourceId - The service ID (bytes32)
   * @param method - HTTP method
   * @param data - Request body (for POST/PUT)
   * @param headers - Additional headers
   * @param options - Optional: fundingModel and endpoint for NATIVE_X402 services
   */
  const makePayment = useCallback(async (
    resourceId: string,
    method: "GET" | "POST" = "GET",
    data?: unknown,
    headers?: Record<string, string>,
    options?: {
      fundingModel?: FundingModel;
      endpoint?: string;
    }
  ) => {
    if (!paymentFetch) {
      if (walletLoading) {
        throw new Error("Wallet is loading, please wait...");
      }
      if (!isConnected) {
        throw new Error("Please connect your wallet first");
      }
      throw new Error("Wallet client not ready. Try reconnecting your wallet.");
    }

    setIsLoading(true);
    setError(null);

    try {
      // Determine URL based on funding model
      // NATIVE_X402 services handle their own x402 - call endpoint directly
      // PROXY_WRAPPED services need to go through the proxy
      let url: string;
      if (options?.fundingModel === FundingModel.NATIVE_X402 && options?.endpoint) {
        url = options.endpoint;
      } else {
        url = `${PROXY_URL}/proxy/${resourceId}`;
      }

      // Build headers - add ngrok header only for direct ngrok calls
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        ...headers,
      };

      // Add ngrok header only for NATIVE_X402 calls to ngrok URLs
      if (options?.fundingModel === FundingModel.NATIVE_X402 && url.includes("ngrok")) {
        requestHeaders["ngrok-skip-browser-warning"] = "true";
      }

      const requestOptions: RequestInit = {
        method,
        headers: requestHeaders,
      };

      if (data && method === "POST") {
        requestOptions.body = JSON.stringify(data);
      }

      const response = await paymentFetch(url, requestOptions);

      if (!response.ok) {
        // Try to parse error response
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || errorData.message || `Request failed: ${response.status}`
        );
      }

      return response.json();
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Payment failed");
      setError(error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [paymentFetch, walletLoading, isConnected]);

  return {
    makePayment,
    isLoading,
    error,
    proxyUrl: PROXY_URL,
    isReady: !!paymentFetch,
    walletLoading,
  };
}
