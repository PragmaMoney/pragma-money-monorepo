import dotenv from "dotenv";
dotenv.config();

export interface Config {
  port: number;
  gatewayAddress: string;
  gatewayRpcUrl: string;
  /** x402 network identifier (e.g. "eip155:10143" for Monad testnet) */
  x402Network: string;
  usdcAddress: string;
  /** @deprecated Use usdcAddress instead */
  mockUsdcAddress: string;
  allowedOrigins: string[];
  serviceRegistryAddress: string;
  adminToken: string;
  proxySignerKey: string;
  identityRegistryAddress: string;
  agentAccountFactoryAddress: string;
  agentPoolFactoryAddress: string;
  fundAmountEoa: string;
  uniswapUniversalRouterAddress: string;
  superRealFakeUsdcAddress: string;
  bingerTokenAddress: string;
  rfusdcAddress: string;
  reputationReporterAddress: string;
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return ["http://localhost:3000", "http://localhost:4402"];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config: Config = {
  port: Number(process.env.PORT) || 4402,
  gatewayAddress:
    process.env.GATEWAY_ADDRESS ||
    "0x76f3a9aE46D58761f073a8686Eb60194B1917E27",
  serviceRegistryAddress:
    process.env.SERVICE_REGISTRY_ADDRESS ||
    "0x7fc78b9769CF0739a5AC2a12D6BfCb121De12A59",
  gatewayRpcUrl:
    process.env.GATEWAY_RPC_URL || "https://testnet-rpc.monad.xyz",
  x402Network:
    process.env.X402_NETWORK || "eip155:10143",
  usdcAddress:
    process.env.USDC_ADDRESS || "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  mockUsdcAddress:
    process.env.MOCK_USDC_ADDRESS || "0x0000000000000000000000000000000000000000",
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  adminToken: process.env.ADMIN_TOKEN || "",
  proxySignerKey: process.env.PROXY_SIGNER_KEY || "",
  identityRegistryAddress:
    process.env.IDENTITY_REGISTRY_ADDRESS || "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentAccountFactoryAddress:
    process.env.AGENT_ACCOUNT_FACTORY_ADDRESS || "0x77F3195CE8E69A76345dBfe5cdAa998a59dE99f5",
  agentPoolFactoryAddress:
    process.env.AGENT_POOL_FACTORY_ADDRESS || "0x42C7A12EA8AcD87367D1d52cb6a6ad6Ca306e9C0",
  fundAmountEoa: process.env.FUND_AMOUNT_EOA || "0.0005",
  uniswapUniversalRouterAddress:
    process.env.UNISWAP_UNIVERSAL_ROUTER_ADDRESS ||
    "0x0000000000000000000000000000000000000000",
  superRealFakeUsdcAddress:
    process.env.SUPER_REAL_FAKE_USDC_ADDRESS ||
    "0x0000000000000000000000000000000000000000",
  bingerTokenAddress:
    process.env.BINGER_TOKEN_ADDRESS ||
    "0x0000000000000000000000000000000000000000",
  rfusdcAddress:
    process.env.RFUSDC_ADDRESS || "0x0000000000000000000000000000000000000000",
  reputationReporterAddress:
    process.env.REPUTATION_REPORTER_ADDRESS || "0x8F10B8537907692d36E078f23525FAFF2756c5ab",
};
