// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ServiceRegistry} from "../src/x402/ServiceRegistry.sol";
import {x402Gateway} from "../src/x402/x402Gateway.sol";
import {AgentSmartAccount} from "../src/Wallet/AgentSmartAccount.sol";
import {AgentAccountFactory} from "../src/Wallet/AgentAccountFactory.sol";
import {AgentFactory} from "../src/Launchpad/AgentFactory.sol";
import {ReputationReporter} from "../src/ERC-8004/ReputationReporter.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {IAgentFactory} from "../src/interfaces/IAgentFactory.sol";
import {ScoreOracle} from "../src/ERC-8004/ScoreOracle.sol";
import {IReputationRegistry} from "../src/interfaces/IReputationRegistry.sol";
import {Addresses} from "../test/Addresses.sol";

/// @title Deploy
/// @notice Deployment script for PragmaMoney contracts on Monad Testnet
/// @dev Uses USDC address from Addresses.sol (no mock deployment)
contract Deploy is Script {
    // Canonical ERC-4337 v0.7 EntryPoint
    address constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);
        console2.log("");

        vm.startBroadcast(deployerPrivateKey);

        Addresses addresses = new Addresses();
        string memory chain = addresses.monadTestnet();
        address usdc = addresses.getAddress(chain, "USDC");
        console2.log("USDC:", usdc);

        // 1. Deploy ServiceRegistry (deployer is the initial owner)
        address identityRegistry = addresses.getAddress(chain, "IdentityRegistry");
        address agentFactory = vm.envAddress("AGENT_FACTORY_ADDRESS");
        ServiceRegistry registry = new ServiceRegistry(deployer, identityRegistry, agentFactory);
        console2.log("ServiceRegistry deployed at:", address(registry));

        // 2. Deploy x402Gateway (requires IdentityRegistry + AgentFactory addresses)
        x402Gateway gateway = new x402Gateway(address(registry), usdc, identityRegistry, agentFactory);
        console2.log("x402Gateway deployed at:", address(gateway));

        // 3. Set gateway as authorized caller on ServiceRegistry
        registry.setGateway(address(gateway));
        console2.log("Gateway authorized on ServiceRegistry");

        // 4. Deploy AgentSmartAccount implementation (logic contract)
        AgentSmartAccount accountImpl = new AgentSmartAccount();
        console2.log("AgentSmartAccount implementation deployed at:", address(accountImpl));

        // 5. Deploy AgentAccountFactory (SpendingPolicy-only, no Merkle root)
        AgentAccountFactory factory = new AgentAccountFactory(address(accountImpl), ENTRY_POINT);
        console2.log("AgentAccountFactory deployed at:", address(factory));


        vm.stopBroadcast();

        // Summary
        console2.log("");
        console2.log("=== Deployment Summary ===");
        console2.log("USDC:                      ", usdc);
        console2.log("ServiceRegistry:           ", address(registry));
        console2.log("x402Gateway:               ", address(gateway));
        console2.log("IdentityRegistry:          ", identityRegistry);
        console2.log("AgentFactory:              ", agentFactory);
        console2.log("AgentSmartAccount (impl):  ", address(accountImpl));
        console2.log("AgentAccountFactory:       ", address(factory));
        console2.log("EntryPoint:                ", ENTRY_POINT);
        console2.log("");
    }
}

// forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast --verify -vvvv

/// @title RedeployRegistryGateway
/// @notice Redeploys ServiceRegistry + x402Gateway with authorized recorder for proxy signer
contract RedeployRegistryGateway is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address proxySigner = vm.envAddress("PROXY_SIGNER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        Addresses addresses = new Addresses();
        string memory chain = addresses.monadTestnet();
        address usdc = addresses.getAddress(chain, "USDC");

        // 1. Deploy new ServiceRegistry
        address identityRegistry = addresses.getAddress(chain, "IdentityRegistry");
        address agentFactory = vm.envAddress("AGENT_FACTORY_ADDRESS");
        ServiceRegistry registry = new ServiceRegistry(deployer, identityRegistry, agentFactory);

        // 2. Deploy new x402Gateway pointing to new registry
        x402Gateway gateway = new x402Gateway(address(registry), usdc, identityRegistry, agentFactory);

        // 3. Authorize gateway on registry
        registry.setGateway(address(gateway));

        // 4. Authorize proxy signer as recorder
        registry.setRecorder(proxySigner, true);

        vm.stopBroadcast();

        console2.log("New ServiceRegistry:", address(registry));
        console2.log("New x402Gateway:", address(gateway));
        console2.log("Proxy signer authorized:", proxySigner);
        console2.log("USDC:", usdc);
    }
}

// forge script script/Deploy.s.sol:RedeployRegistryGateway --rpc-url monad_testnet --broadcast --verify -vvvv

/// @title DeployAgentFactory
/// @notice Deploys ReputationReporter (behind ERC1967Proxy) and AgentFactory on Monad Testnet
contract DeployAgentFactory is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        address deployer = vm.addr(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        Addresses addresses = new Addresses();
        string memory chain = addresses.monadTestnet();
        address identityRegistry = addresses.getAddress(chain, "IdentityRegistry");
        address reputationRegistry = addresses.getAddress(chain, "ReputationRegistry");

        // 1. Deploy ReputationReporter implementation
        ReputationReporter reporterImpl = new ReputationReporter();

        // 2. Deploy ERC1967Proxy pointing to implementation with initializer
        bytes memory initData = abi.encodeCall(
            ReputationReporter.initialize,
            (deployer, deployer, reputationRegistry, identityRegistry)
        );
        ERC1967Proxy reporterProxy = new ERC1967Proxy(address(reporterImpl), initData);

        // 3. Deploy AgentFactory
        AgentFactory factory = new AgentFactory(
            IIdentityRegistry(identityRegistry),
            deployer,   // owner
            deployer,   // admin
            deployer,   // scoreOracle placeholder
            address(reporterProxy) // reputationReporter
        );

        // 4. Set AgentFactory as admin on ReputationReporter
        ReputationReporter(address(reporterProxy)).setAdmin(address(factory));

        vm.stopBroadcast();

        console2.log("ReputationReporter (impl):", address(reporterImpl));
        console2.log("ReputationReporter (proxy):", address(reporterProxy));
        console2.log("AgentFactory:", address(factory));
    }
}

// forge script script/Deploy.s.sol:DeployAgentFactory --rpc-url monad_testnet --broadcast --verify -vvvv

/// @title RedeployGatewayRealUSDC
/// @notice Redeploys ServiceRegistry + x402Gateway using Monad Testnet USDC
/// @dev Uses USDC from Addresses.sol
contract RedeployGatewayRealUSDC is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address proxySigner = vm.envAddress("PROXY_SIGNER_ADDRESS");
        Addresses addresses = new Addresses();
        string memory chain = addresses.monadTestnet();
        address usdc = addresses.getAddress(chain, "USDC");
        address identityRegistry = addresses.getAddress(chain, "IdentityRegistry");
        address agentFactory = vm.envAddress("AGENT_FACTORY_ADDRESS");

        console2.log("Deployer:", deployer);
        console2.log("Proxy signer:", proxySigner);
        console2.log("USDC:", usdc);
        console2.log("IdentityRegistry:", identityRegistry);
        console2.log("AgentFactory:", agentFactory);
        console2.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy new ServiceRegistry
        ServiceRegistry registry = new ServiceRegistry(deployer, identityRegistry, agentFactory);

        // 2. Deploy new x402Gateway pointing to new registry, using REAL USDC
        x402Gateway gateway = new x402Gateway(address(registry), usdc, identityRegistry, agentFactory);

        // 3. Authorize gateway on registry
        registry.setGateway(address(gateway));

        // 4. Authorize proxy signer as recorder (for x402 Path A usage tracking)
        registry.setRecorder(proxySigner, true);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Redeployment Summary (Real USDC) ===");
        console2.log("ServiceRegistry:", address(registry));
        console2.log("x402Gateway:", address(gateway));
        console2.log("USDC:", usdc);
        console2.log("IdentityRegistry:", identityRegistry);
        console2.log("AgentFactory:", agentFactory);
        console2.log("Proxy signer authorized:", proxySigner);
    }
}

// forge script script/Deploy.s.sol:RedeployGatewayRealUSDC --rpc-url monad_testnet --broadcast --verify -vvvv

/// @title RedeployAll
/// @notice Full redeployment of all PragmaMoney contracts on Monad Testnet.
/// @dev Handles circular dependency: AgentFactory needs scoreOracle, ScoreOracle needs agentFactory.
///      Solution: deploy AgentFactory with deployer as placeholder scoreOracle, then deploy ScoreOracle,
///      then call setScoreOracle. Global contracts (IdentityRegistry, ReputationRegistry, EntryPoint, USDC)
///      are NOT redeployed.
contract RedeployAll is Script {
    address constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address proxySigner = vm.envAddress("PROXY_SIGNER_ADDRESS");
        Addresses addresses = new Addresses();
        string memory chain = addresses.monadTestnet();
        address identityRegistry = addresses.getAddress(chain, "IdentityRegistry");
        address reputationRegistry = addresses.getAddress(chain, "ReputationRegistry");
        address usdc = addresses.getAddress(chain, "USDC");

        console2.log("=== RedeployAll ===");
        console2.log("Deployer:", deployer);
        console2.log("Proxy signer:", proxySigner);
        console2.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. AgentSmartAccount implementation (no deps)
        AgentSmartAccount accountImpl = new AgentSmartAccount();
        console2.log("1. AgentSmartAccount impl:", address(accountImpl));

        // 2. AgentAccountFactory (step1 + EntryPoint)
        AgentAccountFactory accountFactory = new AgentAccountFactory(address(accountImpl), ENTRY_POINT);
        console2.log("2. AgentAccountFactory:", address(accountFactory));

        // 3. ReputationReporter implementation (no deps)
        ReputationReporter reporterImpl = new ReputationReporter();
        console2.log("3. ReputationReporter impl:", address(reporterImpl));

        // 4. ReputationReporter ERC1967Proxy (step3, init with deployer as owner+admin)
        bytes memory reporterInitData = abi.encodeCall(
            ReputationReporter.initialize,
            (deployer, deployer, reputationRegistry, identityRegistry)
        );
        ERC1967Proxy reporterProxy = new ERC1967Proxy(address(reporterImpl), reporterInitData);
        console2.log("4. ReputationReporter proxy:", address(reporterProxy));

        // 5. AgentFactory (IdReg, deployer owner, deployer admin, deployer as placeholder scoreOracle, step4)
        AgentFactory agentFactory = new AgentFactory(
            IIdentityRegistry(identityRegistry),
            deployer,                   // owner
            deployer,                   // admin
            deployer,                   // scoreOracle placeholder (will be replaced in step 8)
            address(reporterProxy)      // reputationReporter
        );
        console2.log("5. AgentFactory:", address(agentFactory));

        // 6. Set AgentFactory as admin on ReputationReporter proxy
        ReputationReporter(address(reporterProxy)).setAdmin(address(agentFactory));
        console2.log("6. reporterProxy.setAdmin(agentFactory)");

        // 7. ScoreOracle (RepReg, step5, step4, deployer owner, deployer admin)
        ScoreOracle scoreOracle = new ScoreOracle(
            IReputationRegistry(reputationRegistry),
            IAgentFactory(address(agentFactory)),
            address(reporterProxy),
            deployer,                   // owner
            deployer                    // admin
        );
        console2.log("7. ScoreOracle:", address(scoreOracle));

        // 8. Resolve circular dep: set real ScoreOracle on AgentFactory
        agentFactory.setScoreOracle(address(scoreOracle));
        console2.log("8. agentFactory.setScoreOracle(scoreOracle)");

        // 9. ServiceRegistry (deployer owner, IdReg, step5)
        ServiceRegistry registry = new ServiceRegistry(deployer, identityRegistry, address(agentFactory));
        console2.log("9. ServiceRegistry:", address(registry));

        // 10. x402Gateway (step9, USDC, IdReg, step5)
        x402Gateway gateway = new x402Gateway(address(registry), usdc, identityRegistry, address(agentFactory));
        console2.log("10. x402Gateway:", address(gateway));

        // 11. Authorize gateway on ServiceRegistry
        registry.setGateway(address(gateway));
        console2.log("11. registry.setGateway(gateway)");

        // 12. Authorize proxy signer as recorder on ServiceRegistry
        registry.setRecorder(proxySigner, true);
        console2.log("12. registry.setRecorder(proxySigner)");

        // 13. Set global trusted contracts on AgentAccountFactory
        // These contracts can be called by any agent without per-agent setTargetAllowed
        accountFactory.setTrustedContract(address(gateway), true);
        accountFactory.setTrustedContract(address(registry), true);
        accountFactory.setTrustedContract(address(reporterProxy), true);
        accountFactory.setTrustedContract(usdc, true);
        console2.log("13. Set trusted contracts: gateway, registry, reporter, USDC");

        // 14. Set global trusted tokens on AgentAccountFactory
        accountFactory.setTrustedToken(usdc, true);
        console2.log("14. Set trusted token: USDC");

        vm.stopBroadcast();

        // ── Summary ──
        console2.log("");
        console2.log("=== Deployment Summary ===");
        console2.log("AgentSmartAccount (impl):  ", address(accountImpl));
        console2.log("AgentAccountFactory:       ", address(accountFactory));
        console2.log("ReputationReporter (impl): ", address(reporterImpl));
        console2.log("ReputationReporter (proxy):", address(reporterProxy));
        console2.log("AgentFactory:              ", address(agentFactory));
        console2.log("ScoreOracle:               ", address(scoreOracle));
        console2.log("ServiceRegistry:           ", address(registry));
        console2.log("x402Gateway:               ", address(gateway));
        console2.log("");
        console2.log("=== Globals (unchanged) ===");
        console2.log("IdentityRegistry:          ", identityRegistry);
        console2.log("ReputationRegistry:        ", reputationRegistry);
        console2.log("EntryPoint v0.7:           ", ENTRY_POINT);
        console2.log("USDC:                      ", usdc);
        console2.log("Proxy signer:              ", proxySigner);
        console2.log("");
        console2.log("=== Global Trusted Contracts ===");
        console2.log("Gateway, Registry, Reporter, USDC, SuperRealFakeUSDC, BingerToken, RFUSDC");
    }
}

// forge script script/Deploy.s.sol:RedeployAll --rpc-url monad_testnet --broadcast --verify -vvvv
