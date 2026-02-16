import dotenv from "dotenv";
dotenv.config();

export interface Config {
  port: number;
  /** Public URL for the proxy (e.g. Cloudflare tunnel URL) */
  publicUrl: string;
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
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${Number(process.env.PORT) || 4402}`,
  gatewayAddress:
    process.env.GATEWAY_ADDRESS ||
    "0x2B374335B3f3BBa301210a87dF6FB06a18125935",
  serviceRegistryAddress:
    process.env.SERVICE_REGISTRY_ADDRESS ||
    "0x1d8E4C83BADf70F2AE7F03bc41bD450Bcc9FD7f8",
  gatewayRpcUrl:
    process.env.GATEWAY_RPC_URL || "https://monad-testnet.g.alchemy.com/v2/4hrf7RNwCc-ScxIMXTvkM1wMNgXEQvFu",
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
    process.env.AGENT_ACCOUNT_FACTORY_ADDRESS || "0xb7769DF02e0D8039c72A9b4BbABE3d2855C54711",
  agentPoolFactoryAddress:
    process.env.AGENT_POOL_FACTORY_ADDRESS || "0x58C6C01920cf8b216aB303815A818D6E890F342a",
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
    process.env.REPUTATION_REPORTER_ADDRESS || "0xFC121b8b58ceaAe84b4461Ded2806C36904A773E",
};
