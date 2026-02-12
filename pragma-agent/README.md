# pragma-agent — PragmaMoney CLI + OpenClaw Skill

A CLI tool and OpenClaw skill that gives AI agents the ability to register on-chain, manage wallets, browse services, and pay for API calls on PragmaMoney (Monad Testnet).

## Quick Start

```bash
cd pragma-agent
npm install && npm run build
npm link  # makes `pragma-agent` available globally

# Set environment variables
export PIMLICO_API_KEY=pim_R9KtmJWQiydF7eX7mgpGsZ
export RELAYER_URL=http://localhost:4402

# Test it
pragma-agent wallet address
pragma-agent services list
```

## CLI Usage

```
pragma-agent register   --name "X" --endpoint "https://..." --daily-limit 100 --expiry-days 90 --pool-daily-cap 50
pragma-agent wallet     [balance|address|policy]
pragma-agent services   [list|get --service-id 0x...|search --query "keyword"]
pragma-agent pool       [info|remaining|pull --amount 5.00]
pragma-agent pay        [pay --service-id 0x... --calls 1|verify --payment-id 0x...]
pragma-agent call       --service-id 0x... [--method POST] [--body '{"key":"val"}']
```

All commands output JSON to stdout. Exit code 0 on success, 1 on error.

Run `pragma-agent --help` for full usage info.

## Architecture

```
VPS (Contabo / any Linux server)          Your machine / separate server
┌──────────────────────────────┐          ┌──────────────────────────────┐
│  OpenClaw + pragma-agent CLI │  ←HTTP→  │  Proxy server (port 4402)    │
│  (agent runtime)             │          │  (registration relay,        │
│                              │          │   payment verification,      │
│  ~/.openclaw/pragma-agent/   │          │   API forwarding)            │
│    wallet.json               │          │                              │
│                              │          │  Uses deployer key (0x567b)  │
└──────────────────────────────┘          └──────────────────────────────┘
         │                                         │
         └──── Monad Testnet RPC ──────────────────┘
```

The AI agent reads the SKILL.md instructions, then runs `pragma-agent` CLI commands via bash. This matches the established OpenClaw pattern (oracle, himalaya skills). The proxy server can run anywhere the agent can reach over HTTP.

## VPS Setup (Contabo / Any Linux VPS)

### Prerequisites

- **Node.js 22+**
- **git**
- **Pimlico API key** (free tier at [pimlico.io](https://pimlico.io)) — required for UserOps

### 1. Install Node.js

```bash
apt-get update && apt-get install -y git curl build-essential unzip

# Install Node.js 22 via fnm
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22 && fnm use 22 && fnm default 22
node -v  # should print v22.x.x
```

### 2. Clone & build pragma-agent

```bash
cd ~
git clone https://github.com/gabr1234iel/PragmaMoney.git
cd PragmaMoney/pragma-agent
npm install && npm run build && npm link
```

### 3. Configure environment

```bash
cat > .env <<'EOF'
# Required for UserOps (pay, pool pull, call services)
PIMLICO_API_KEY=pim_R9KtmJWQiydF7eX7mgpGsZ

# Proxy relayer URL (where the proxy server is running)
# If proxy is on the same VPS: http://localhost:4402
# If proxy is on another machine: http://<proxy-ip>:4402
RELAYER_URL=http://localhost:4402
EOF
```

### 4. Test CLI

```bash
pragma-agent --help
pragma-agent wallet address
```

### 5. Install OpenClaw & register skill

```bash
# Install OpenClaw
curl -fsSL https://openclaw.ai/install.sh | bash

# Option A: Add as load path in config
openclaw config set plugins.load.paths '["~/PragmaMoney/pragma-agent"]'

# Option B: Copy skill manually
mkdir -p ~/.openclaw/skills/pragma-money
cp skills/pragma-money/SKILL.md ~/.openclaw/skills/pragma-money/
```

### 6. Run OpenClaw

```bash
openclaw
```

In the OpenClaw chat:
```
> Register yourself as "MyTestAgent" at endpoint https://myagent.example.com
> with a daily limit of 100 USDC, 90-day expiry, and pool daily cap of 50 USDC.
```

## Proxy Setup (separate server)

The proxy relayer handles deployer-signed transactions. Run it on a server with the deployer private key:

```bash
cd PragmaMoney/proxy
npm install && npm run build

cat > .env <<'EOF'
PROXY_SIGNER_KEY=<your-deployer-private-key>
ADMIN_TOKEN=changeme
EOF

npm run dev  # listens on port 4402
```

The proxy must be reachable from the VPS (public IP, ngrok tunnel, or Tailscale).

## Registration Flow

The 3-phase registration ensures the agent EOA owns its identity NFT:

```
1. POST /register-agent/fund     → Proxy sends 0.0005 MON to agent EOA
2. Agent tx: register()           → Agent EOA calls IdentityRegistry (owns NFT)
3. POST /register-agent/setup     → Proxy deploys smart account + configures targets
4. Agent tx: setAgentWallet()     → Agent EOA binds smart account to identity
5. POST /register-agent/finalize  → Proxy creates investor pool + allows as target
```

## Verify On-Chain State

| Check | URL |
|-------|-----|
| Agent EOA funded | `<explorer>/address/<agent-eoa>#internaltx` |
| NFT owned by agent | `ownerOf(agentId)` on `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Smart account deployed | `<explorer>/address/<smart-account>#code` |
| agentWallet set | `getAgentWallet(agentId)` on `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Pool created | `<explorer>/address/<pool-address>#readContract` |

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `Fund phase failed` | Proxy not running or deployer out of MON | Start proxy, fund deployer |
| `Failed to extract agentId` | register() tx failed | Check agent EOA has MON for gas |
| `NFT owner mismatch` | Wrong agentId | Verify agentId from register() tx |
| `BadWallet (0x5c9c2255)` | Pool created before setAgentWallet | This is handled by 3-phase flow |
| `setAgentWallet expired` | 5-min deadline passed | Re-run setup for fresh deadline |
| `PIMLICO_API_KEY not set` | Missing env var | Set in .env before starting |
| `Agent already registered` | wallet.json has registration | Delete `~/.openclaw/pragma-agent/wallet.json` |

## Wallet File

Location: `~/.openclaw/pragma-agent/wallet.json`

```json
{
  "privateKey": "0x...",
  "address": "0x...",
  "createdAt": "2026-02-06T...",
  "registration": {
    "agentId": "213",
    "smartAccount": "0x...",
    "poolAddress": "0x...",
    "owner": "0x...",
    "registeredAt": "2026-02-06T...",
    "txHashes": { "fund": "0x...", "register": "0x...", ... }
  }
}
```

Delete this file to reset and re-register.

## Contract Addresses (Monad Testnet)

| Contract | Address |
|----------|---------|
| USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| AgentAccountFactory | `0x84277eA30ec0a43ED362904308C0A72bF5269196` |
| AgentFactory (pools) | `0x2Cd3c8D045b29B1baC914722D85419964DBD79B7` |
| ServiceRegistry | `0xCd5792dDdd3A7b98221223EFE5aCbC302a20A76e` |
| x402Gateway | `0x8887dD91C983b2c647a41DEce32c34E79c7C33df` |
| EntryPoint (v0.7) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
