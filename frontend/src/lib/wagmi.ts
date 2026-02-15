import { http, createConfig } from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { monadTestnet } from "@/lib/chain";

export const config = createConfig({
  chains: [monadTestnet, mainnet],
  connectors: [
    injected({ target: "metaMask" }),
    coinbaseWallet({
      appName: "Clawmono",
      appLogoUrl: undefined,
    }),
  ],
  transports: {
    [monadTestnet.id]: http(
      process.env.NEXT_PUBLIC_MONAD_RPC || "https://testnet-rpc.monad.xyz"
    ),
    [mainnet.id]: http(), // For ENS resolution
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
