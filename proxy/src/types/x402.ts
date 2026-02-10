/**
 * Proxy type definitions for PragmaMoney.
 *
 * These types model the on-chain gateway payment path and
 * the shared resource/transaction types used by the proxy.
 */

export interface PaymentRequirementsAccept {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: {
    name: string;
    version: string;
  };
}

// ---------------------------------------------------------------------------
// On-chain Gateway Types (agent path)
// ---------------------------------------------------------------------------

export interface GatewayPayment {
  paymentId: string;
  payer: string;
  amount: bigint;
  serviceId: string;
  valid: boolean;
}

export interface VerifyResult {
  valid: boolean;
  payer: string;
  amount: bigint;
}

// ---------------------------------------------------------------------------
// Resource Types
// ---------------------------------------------------------------------------

export type ServiceType = "COMPUTE" | "STORAGE" | "API" | "AGENT" | "OTHER";

export interface ResourcePricing {
  /** Price per call in atomic USDC units (6 decimals). E.g. "1000" = 0.001 USDC */
  pricePerCall: string;
  currency: "USDC";
}

export interface Resource {
  id: string;
  name: string;
  type: ServiceType;
  creatorAddress: string;
  originalUrl: string;
  proxyUrl: string;
  pricing: ResourcePricing;
  apiKey?: string;
  apiKeyHeader?: string;
}

// ---------------------------------------------------------------------------
// Transaction / Audit Types
// ---------------------------------------------------------------------------

export type PaymentMethod = "gateway";
export type TransactionStatus = "pending" | "verified" | "settled" | "failed";

export interface Transaction {
  id: string;
  resourceId: string;
  payer: string;
  amount: string;
  method: PaymentMethod;
  timestamp: number;
  status: TransactionStatus;
  paymentId?: string;
}

// ---------------------------------------------------------------------------
// 402 Error Response
// ---------------------------------------------------------------------------

export interface X402ErrorResponse {
  x402Version: number;
  error: string;
  accepts: PaymentRequirementsAccept[];
  gatewayContract: string;
  serviceId: string;
}
