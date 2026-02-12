import { http, createConfig } from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { monadTestnet } from "@/lib/chain";

export const config = createConfig({
  chains: [monadTestnet],
  connectors: [
    injected({ target: "metaMask" }),
    coinbaseWallet({
      appName: "PragmaMoney",
      appLogoUrl: undefined,
    }),
  ],
  transports: {
    [monadTestnet.id]: http(
      process.env.NEXT_PUBLIC_MONAD_RPC || "https://testnet-rpc.monad.xyz"
    ),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
