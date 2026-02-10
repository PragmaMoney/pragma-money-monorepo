// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {AgentSmartAccount} from "../src/Wallet/AgentSmartAccount.sol";
import {AgentAccountFactory} from "../src/Wallet/AgentAccountFactory.sol";

/// @title RedeployWallet
/// @notice Redeploys AgentSmartAccount impl + AgentAccountFactory with trusted contracts
/// @dev Fixes: isTargetAllowed/isTokenAllowed now check factory globals (not just per-agent)
contract RedeployWallet is Script {
    address constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address constant REAL_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Existing contract addresses to set as trusted
    address constant GATEWAY = 0x6f29093e31136644BEDd0c4a904d13334Db1e60C;
    address constant SERVICE_REGISTRY = 0x1Ace3c1Ac3E4D849373017B43804Eb515516950E;
    address constant REPUTATION_REPORTER = 0x3FB6ed48640ec7B90E6Ff642c533098c5c80d0c4;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("=== RedeployWallet ===");
        console2.log("Deployer:", deployer);
        console2.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy new AgentSmartAccount implementation (with isTargetAllowed fix)
        AgentSmartAccount impl = new AgentSmartAccount();
        console2.log("1. AgentSmartAccount impl:", address(impl));

        // 2. Deploy new AgentAccountFactory pointing to new impl
        AgentAccountFactory factory = new AgentAccountFactory(address(impl), ENTRY_POINT);
        console2.log("2. AgentAccountFactory:", address(factory));

        // 3. Set global trusted contracts
        factory.setTrustedContract(GATEWAY, true);
        factory.setTrustedContract(SERVICE_REGISTRY, true);
        factory.setTrustedContract(REPUTATION_REPORTER, true);
        factory.setTrustedContract(REAL_USDC, true);
        console2.log("3. Set trusted contracts");

        // 4. Set global trusted tokens
        factory.setTrustedToken(REAL_USDC, true);
        console2.log("4. Set trusted tokens");

        vm.stopBroadcast();

        // Summary
        console2.log("");
        console2.log("=== Update These Config Files ===");
        console2.log("");
        console2.log("proxy/.env:");
        console2.log("  AGENT_ACCOUNT_FACTORY_ADDRESS=", address(factory));
        console2.log("");
        console2.log("pragma-agent/src/config.ts:");
        console2.log("  AGENT_ACCOUNT_FACTORY_ADDRESS =", address(factory));
        console2.log("");
        console2.log("frontend/src/lib/contracts.ts:");
        console2.log("  AGENT_FACTORY_ADDRESS =", address(factory));
    }
}

// forge script script/RedeployWallet.s.sol:RedeployWallet --rpc-url base_sepolia --broadcast -vvvv
