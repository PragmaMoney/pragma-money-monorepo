import dotenv from "dotenv";
dotenv.config();

export interface Config {
  port: number;
  gatewayAddress: string;
  gatewayRpcUrl: string;
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
    "0x8887dD91C983b2c647a41DEce32c34E79c7C33df",
  serviceRegistryAddress:
    process.env.SERVICE_REGISTRY_ADDRESS ||
    "0xCd5792dDdd3A7b98221223EFE5aCbC302a20A76e",
  gatewayRpcUrl:
    process.env.GATEWAY_RPC_URL || "https://testnet-rpc.monad.xyz",
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
    process.env.AGENT_ACCOUNT_FACTORY_ADDRESS || "0x84277eA30ec0a43ED362904308C0A72bF5269196",
  agentPoolFactoryAddress:
    process.env.AGENT_POOL_FACTORY_ADDRESS || "0xF6CA25ebA2Dc010d19507D2C6138ba2598B7b974",
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
    process.env.REPUTATION_REPORTER_ADDRESS || "0x2E3A2591561329ED54C88A84aD95E21e6192a907",
};
