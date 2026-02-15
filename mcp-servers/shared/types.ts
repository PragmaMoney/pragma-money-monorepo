// MCP Service Types

export type FundingModel = "PROXY_WRAPPED" | "NATIVE_X402";

export interface MCPServiceConfig {
  name: string;
  description: string;
  version: string;
  pricePerCall: string; // Atomic USDC (6 decimals)
  type: ServiceType;
  fundingModel?: FundingModel; // PROXY_WRAPPED (default) or NATIVE_X402
  tools: MCPTool[];
}

export type ServiceType = "COMPUTE" | "STORAGE" | "API" | "AGENT" | "OTHER";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  outputSchema: JSONSchema;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  items?: JSONSchema;
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  format?: string;
}

// MCP JSON-RPC types
export interface MCPRequest {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
  id: number | string;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  result?: MCPResult;
  error?: MCPError;
  id: number | string;
}

export interface MCPResult {
  content: MCPContent[];
  isError?: boolean;
}

export interface MCPContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

// x402 v2 types

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

/** x402 v2 402 response body */
export interface X402ErrorResponse {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirementsAccept[];
  resource: X402Resource;
}

// Tool handler type
export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<MCPContent[]>;
