/**
 * Proxy type definitions for PragmaMoney.
 *
 * These types model the on-chain gateway payment path and
 * the shared resource/transaction types used by the proxy.
 */

/** x402 v2 accepted object - payment requirements */
export interface PaymentRequirementsAccept {
  scheme: string;
  network: string;
  /** Amount in smallest token units (e.g. "1000" for 0.001 USDC) */
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: {
    name: string;
    version: string;
  };
}

/** x402 v2 resource object */
export interface X402Resource {
  url: string;
  description: string;
  mimeType: string;
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

/** Funding model determines payment routing */
export type FundingModel = "PROXY_WRAPPED" | "NATIVE_X402";

export interface ResourcePricing {
  /** Price per call in atomic USDC units (6 decimals). E.g. "1000" = 0.001 USDC */
  pricePerCall: string;
  currency: "USDC";
}

export interface ResourceSchema {
  input: object | null;
  output: object | null;
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
  /** Funding model determines payment routing (split vs direct) */
  fundingModel?: FundingModel;
  /** Optional JSON Schema for input/output format (agent interoperability) */
  schema?: ResourceSchema;
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

/** x402 v2 402 response body */
export interface X402ErrorResponse {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirementsAccept[];
  resource: X402Resource;
}
