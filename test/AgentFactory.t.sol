// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentFactory} from "../src/Launchpad/AgentFactory.sol";
import {IIdentityRegistry as FactoryIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {AgentPool} from "../src/Launchpad/AgentPool.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {IReputationRegistry} from "../src/interfaces/IReputationRegistry.sol";
import {ReputationReporter} from "../src/ERC-8004/ReputationReporter.sol";
import {Errors} from "../src/errors/Errors.sol";
import {BaseTest} from "./BaseTest.t.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vm} from "forge-std/Vm.sol";

contract AgentFactoryTest is BaseTest {
    IIdentityRegistry internal id;
    AgentFactory internal factory;
    ReputationReporter internal reporter;

    function setUp() public {
        _startFork();
        _setupUsdc();
        vm.startPrank(deployer);
        id = _deployIdentity();
        IReputationRegistry rep = _deployReputation(address(id));
        reporter = _deployReporter(address(rep), address(id));
        factory = new AgentFactory(FactoryIdentityRegistry(address(id)), deployer, deployer, deployer, address(reporter));
        reporter.setAdmin(address(factory));
        vm.stopPrank();
    }

    function test_createAgent_deploysPool_for_registered_identity() public {
        AgentFactory.CreateParams memory p = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-1.json",
            asset: IERC20(address(usdc)),
            name: "Agent Pool",
            symbol: "APOOL",
            poolOwner: deployer,
            dailyCap: 100e6,
            vestingDuration: 7 days,
            metadataURI: "file://metadata/agent-1.json"
        });

        vm.prank(agentOwner);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(deployer);
        address poolAddr = factory.createAgentPool(agentId, agentOwner, p);

        assertEq(id.ownerOf(agentId), agentOwner);
        assertTrue(poolAddr != address(0));

        AgentPool pool = AgentPool(poolAddr);
        assertEq(address(pool.asset()), address(usdc));
    }

    function test_onlyAuthorized_can_create_agent_pool() public {
        AgentFactory.CreateParams memory p = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-1.json",
            asset: IERC20(address(usdc)),
            name: "Agent Pool",
            symbol: "APOOL",
            poolOwner: deployer,
            dailyCap: 100e6,
            vestingDuration: 7 days,
            metadataURI: "file://metadata/agent-1.json"
        });

        vm.prank(agentOwner);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(alice);
        vm.expectRevert(Errors.NotAuthorized.selector);
        factory.createAgentPool(agentId, agentOwner, p);

        vm.prank(deployer);
        address poolAddr = factory.createAgentPool(agentId, agentOwner, p);
        assertEq(id.ownerOf(agentId), agentOwner);
        assertTrue(poolAddr != address(0));
    }

    function test_createAgent_emits_events() public {
        AgentFactory.CreateParams memory p = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-1.json",
            asset: IERC20(address(usdc)),
            name: "Agent Pool",
            symbol: "APOOL",
            poolOwner: deployer,
            dailyCap: 100e6,
            vestingDuration: 7 days,
            metadataURI: "file://metadata/agent-1.json"
        });

        vm.recordLogs();
        vm.prank(agentOwner);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(deployer);
        factory.createAgentPool(agentId, agentOwner, p);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 sig = keccak256("AgentPoolCreated(address,uint256,address)");
        bool found;
        for (uint256 i; i < entries.length; i++) {
            if (entries[i].topics.length > 0 && entries[i].topics[0] == sig) {
                found = true;
                break;
            }
        }
        assertTrue(found);
    }

    function test_multipleAgents_have_isolatedPools() public {
        AgentFactory.CreateParams memory p1 = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-1.json",
            asset: IERC20(address(usdc)),
            name: "Agent Pool 1",
            symbol: "AP1",
            poolOwner: deployer,
            dailyCap: 100e6,
            vestingDuration: 7 days,
            metadataURI: "file://metadata/agent-1.json"
        });

        AgentFactory.CreateParams memory p2 = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-2.json",
            asset: IERC20(address(usdc)),
            name: "Agent Pool 2",
            symbol: "AP2",
            poolOwner: deployer,
            dailyCap: 50e6,
            vestingDuration: 1 days,
            metadataURI: "file://metadata/agent-2.json"
        });

        vm.prank(agentOwner);
        uint256 agentId1 = id.register("file://metadata/agent-1.json");
        vm.prank(bob);
        uint256 agentId2 = id.register("file://metadata/agent-2.json");

        vm.prank(deployer);
        address pool1 = factory.createAgentPool(agentId1, agentOwner, p1);
        vm.prank(deployer);
        address pool2 = factory.createAgentPool(agentId2, bob, p2);

        assertTrue(pool1 != pool2);
    }

    /// @notice poolByAgentId returns the pool created for the agentId
    function test_poolByAgentId_returnsCreatedPool() public {
        AgentFactory.CreateParams memory p = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-1.json",
            asset: IERC20(address(usdc)),
            name: "Agent Pool",
            symbol: "APOOL",
            poolOwner: deployer,
            dailyCap: 100e6,
            vestingDuration: 7 days,
            metadataURI: "file://metadata/agent-1.json"
        });

        vm.prank(agentOwner);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(deployer);
        address pool1 = factory.createAgentPool(agentId, agentOwner, p);

        address pool = factory.poolByAgentId(agentId);
        assertEq(pool, pool1);
    }

    /// @notice agentCount returns the correct number of agents with pools
    function test_agentCount_returnsCorrectCount() public {
        AgentFactory.CreateParams memory p1 = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-1.json",
            asset: IERC20(address(usdc)),
            name: "Agent Pool 1",
            symbol: "AP1",
            poolOwner: deployer,
            dailyCap: 100e6,
            vestingDuration: 7 days,
            metadataURI: "file://metadata/agent-1.json"
        });

        AgentFactory.CreateParams memory p2 = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-2.json",
            asset: IERC20(address(usdc)),
            name: "Agent Pool 2",
            symbol: "AP2",
            poolOwner: deployer,
            dailyCap: 50e6,
            vestingDuration: 1 days,
            metadataURI: "file://metadata/agent-2.json"
        });

        vm.prank(agentOwner);
        uint256 agentId1 = id.register("file://metadata/agent-1.json");
        vm.prank(bob);
        uint256 agentId2 = id.register("file://metadata/agent-2.json");

        assertEq(factory.agentCount(), 0);

        vm.prank(deployer);
        factory.createAgentPool(agentId1, agentOwner, p1);
        assertEq(factory.agentCount(), 1);

        vm.prank(deployer);
        factory.createAgentPool(agentId2, bob, p2);
        assertEq(factory.agentCount(), 2);
    }

    /// @notice getAgentIdAt returns the correct agentId for a given index
    function test_getAgentIdAt_returnsCorrectId() public {
        AgentFactory.CreateParams memory p = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-1.json",
            asset: IERC20(address(usdc)),
            name: "Agent Pool",
            symbol: "APOOL",
            poolOwner: deployer,
            dailyCap: 100e6,
            vestingDuration: 7 days,
            metadataURI: "file://metadata/agent-1.json"
        });

        vm.prank(agentOwner);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(deployer);
        factory.createAgentPool(agentId, agentOwner, p);

        assertEq(factory.getAgentIdAt(0), agentId);
    }

    /// @notice Agent owner (identity NFT holder) can create their own pool
    function test_agentOwner_canCreatePool() public {
        AgentFactory.CreateParams memory p = AgentFactory.CreateParams({
            agentURI: "file://metadata/agent-1.json",
            asset: IERC20(address(usdc)),
            name: "Alice Agent Pool",
            symbol: "AALICE",
            poolOwner: alice,
            dailyCap: 100e6,
            vestingDuration: 7 days,
            metadataURI: "file://metadata/agent-1.json"
        });

        // alice registers identity — default wallet is alice
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");
        assertEq(id.ownerOf(agentId), alice);
        assertEq(id.getAgentWallet(agentId), alice);

        // alice (not deployer/admin) calls createAgentPool directly
        vm.prank(alice);
        address poolAddr = factory.createAgentPool(agentId, alice, p);

        assertTrue(poolAddr != address(0));
        assertEq(factory.poolByAgentId(agentId), poolAddr);
        assertEq(factory.agentCount(), 1);
        assertEq(factory.getAgentIdAt(0), agentId);
    }

    /// @notice getAgentIdAt reverts when index is out of bounds
    function test_getAgentIdAt_revertsOutOfBounds() public {
        vm.expectRevert(Errors.IndexOutOfBounds.selector);
        factory.getAgentIdAt(0);
    }

    // ==================== setFundingConfig / getFundingConfig ====================

    /// @notice getFundingConfig returns default values (false, 0) for new agent
    function test_getFundingConfig_defaultValues() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        (bool needsFunding, uint16 splitRatio) = factory.getFundingConfig(agentId);
        assertFalse(needsFunding);
        assertEq(splitRatio, 0);
    }

    /// @notice Owner can set funding config
    function test_setFundingConfig_asOwner() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(deployer);
        factory.setFundingConfig(agentId, true, 4000);

        (bool needsFunding, uint16 splitRatio) = factory.getFundingConfig(agentId);
        assertTrue(needsFunding);
        assertEq(splitRatio, 4000);
    }

    /// @notice Admin can set funding config
    function test_setFundingConfig_asAdmin() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        // deployer is also admin in this test setup
        vm.prank(deployer);
        factory.setFundingConfig(agentId, true, 3000);

        (bool needsFunding, uint16 splitRatio) = factory.getFundingConfig(agentId);
        assertTrue(needsFunding);
        assertEq(splitRatio, 3000);
    }

    /// @notice Agent owner (NFT holder) can set funding config
    function test_setFundingConfig_asAgentOwner() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(alice);
        factory.setFundingConfig(agentId, true, 5000);

        (bool needsFunding, uint16 splitRatio) = factory.getFundingConfig(agentId);
        assertTrue(needsFunding);
        assertEq(splitRatio, 5000);
    }

    /// @notice Unauthorized user cannot set funding config
    function test_setFundingConfig_revertsUnauthorized() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(bob);
        vm.expectRevert(Errors.NotAuthorized.selector);
        factory.setFundingConfig(agentId, true, 4000);
    }

    /// @notice Setting splitRatio > 10000 reverts
    function test_setFundingConfig_revertsInvalidRatio() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(deployer);
        vm.expectRevert(Errors.InvalidRatio.selector);
        factory.setFundingConfig(agentId, true, 10001);
    }

    /// @notice setFundingConfig emits FundingConfigUpdated event
    function test_setFundingConfig_emitsEvent() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.expectEmit(true, false, false, true);
        emit AgentFactory.FundingConfigUpdated(agentId, true, 4000);

        vm.prank(deployer);
        factory.setFundingConfig(agentId, true, 4000);
    }

    /// @notice Can update existing funding config
    function test_setFundingConfig_updatesExisting() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(deployer);
        factory.setFundingConfig(agentId, true, 4000);

        (bool needsFunding1, uint16 splitRatio1) = factory.getFundingConfig(agentId);
        assertTrue(needsFunding1);
        assertEq(splitRatio1, 4000);

        vm.prank(deployer);
        factory.setFundingConfig(agentId, false, 6000);

        (bool needsFunding2, uint16 splitRatio2) = factory.getFundingConfig(agentId);
        assertFalse(needsFunding2);
        assertEq(splitRatio2, 6000);
    }

    /// @notice Zero splitRatio is valid
    function test_setFundingConfig_zeroRatio() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(deployer);
        factory.setFundingConfig(agentId, true, 0);

        (bool needsFunding, uint16 splitRatio) = factory.getFundingConfig(agentId);
        assertTrue(needsFunding);
        assertEq(splitRatio, 0);
    }

    /// @notice Max splitRatio (10000 = 100%) is valid
    function test_setFundingConfig_maxRatio() public {
        vm.prank(alice);
        uint256 agentId = id.register("file://metadata/agent-1.json");

        vm.prank(deployer);
        factory.setFundingConfig(agentId, true, 10000);

        (bool needsFunding, uint16 splitRatio) = factory.getFundingConfig(agentId);
        assertTrue(needsFunding);
        assertEq(splitRatio, 10000);
    }
}
