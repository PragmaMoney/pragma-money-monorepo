// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseTest} from "./BaseTest.t.sol";
import {x402Gateway} from "../src/x402/x402Gateway.sol";
import {Ix402Gateway} from "../src/x402/interfaces/Ix402Gateway.sol";
import {ServiceRegistry} from "../src/x402/ServiceRegistry.sol";
import {IServiceRegistry} from "../src/x402/interfaces/IServiceRegistry.sol";
import {AgentFactory} from "../src/Launchpad/AgentFactory.sol";
import {AgentPool} from "../src/Launchpad/AgentPool.sol";
import {ReputationReporter} from "../src/ERC-8004/ReputationReporter.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";
import {IReputationRegistry} from "../src/interfaces/IReputationRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract x402GatewayTest is BaseTest {
    x402Gateway public gateway;
    ServiceRegistry public registry;
    IIdentityRegistry public identityRegistry;
    IReputationRegistry public reputationRegistry;
    ReputationReporter public reporter;
    AgentFactory public agentFactory;
    AgentPool public pool;

    address public registryOwner;
    address public serviceOwner;
    address public payer;
    address public stranger;

    bytes32 public constant SERVICE_ID = keccak256("test-service-1");
    uint256 public constant PRICE_PER_CALL = 1000; // 0.001 USDC
    string public constant ENDPOINT = "https://api.example.com/v1";
    uint256 public agentId;

    function setUp() public {
        _startFork();
        _setupUsdc();

        registryOwner = deployer;
        serviceOwner = agentOwner;
        payer = alice;
        stranger = bob;

        vm.startPrank(deployer);
        identityRegistry = _deployIdentity();
        reputationRegistry = _deployReputation(address(identityRegistry));
        reporter = _deployReporter(address(reputationRegistry), address(identityRegistry));
        agentFactory = new AgentFactory(IIdentityRegistry(address(identityRegistry)), deployer, deployer, deployer, address(reporter));
        reporter.setAdmin(address(agentFactory));
        vm.stopPrank();

        vm.prank(agentOwner);
        agentId = identityRegistry.register("file://metadata/agent-1.json");

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

        vm.prank(deployer);
        address poolAddr = agentFactory.createAgentPool(agentId, agentOwner, p);
        pool = AgentPool(poolAddr);

        registry = new ServiceRegistry(registryOwner, address(identityRegistry), address(agentFactory));
        gateway = new x402Gateway(address(registry), address(usdc), address(identityRegistry), address(agentFactory));

        vm.prank(registryOwner);
        registry.setGateway(address(gateway));

        vm.prank(serviceOwner);
        registry.registerService(
            SERVICE_ID,
            agentId,
            "Test Service",
            PRICE_PER_CALL,
            ENDPOINT,
            IServiceRegistry.ServiceType.API,
            IServiceRegistry.PaymentMode.PROXY_WRAPPED
        );

        deal(address(usdc), payer, 1_000_000e6);
        vm.prank(payer);
        usdc.approve(address(gateway), type(uint256).max);

        // Set default funding config: needsFunding=true, splitRatio=4000 (40%)
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, true, 4000);
    }

    // ==================== payForService ====================

    function test_PayForService_SingleCall() public {
        uint256 calls = 1;
        uint256 expectedTotal = PRICE_PER_CALL * calls;
        uint256 payerBalBefore = usdc.balanceOf(payer);
        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        bytes32 paymentId = gateway.payForService(SERVICE_ID, calls);

        // Verify USDC transfer
        uint256 poolShare = (expectedTotal * 4000) / 10_000;
        uint256 agentShare = expectedTotal - poolShare;
        assertEq(usdc.balanceOf(payer), payerBalBefore - expectedTotal);
        assertEq(usdc.balanceOf(address(pool)), poolBalBefore + poolShare);
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore + agentShare);

        // Verify payment record
        Ix402Gateway.Payment memory payment = gateway.getPayment(paymentId);
        assertEq(payment.payer, payer);
        assertEq(payment.serviceId, SERVICE_ID);
        assertEq(payment.calls, calls);
        assertEq(payment.amount, expectedTotal);
        assertTrue(payment.valid);
    }

    function test_PayForService_MultipleCalls() public {
        uint256 calls = 100;
        uint256 expectedTotal = PRICE_PER_CALL * calls;

        vm.prank(payer);
        bytes32 paymentId = gateway.payForService(SERVICE_ID, calls);

        Ix402Gateway.Payment memory payment = gateway.getPayment(paymentId);
        assertEq(payment.amount, expectedTotal);
        assertEq(payment.calls, calls);
    }

    function test_PayForService_EmitsServicePaid() public {
        uint256 calls = 5;
        uint256 expectedTotal = PRICE_PER_CALL * calls;

        // We cannot predict the exact paymentId ahead of time because it depends on nonce,
        // but we can check the indexed parameters
        vm.prank(payer);

        // Expect event with indexed: payer, serviceId, paymentId; non-indexed: calls, amount
        // We check topic1 (payer) and topic2 (serviceId) but skip topic3 (paymentId)
        vm.expectEmit(true, true, false, true);
        emit Ix402Gateway.ServicePaid(payer, SERVICE_ID, calls, expectedTotal, bytes32(0));

        gateway.payForService(SERVICE_ID, calls);
    }

    function test_PayForService_UniquePaymentIds() public {
        vm.startPrank(payer);

        bytes32 id1 = gateway.payForService(SERVICE_ID, 1);
        bytes32 id2 = gateway.payForService(SERVICE_ID, 1);
        bytes32 id3 = gateway.payForService(SERVICE_ID, 1);

        vm.stopPrank();

        // All IDs must be unique
        assertTrue(id1 != id2);
        assertTrue(id2 != id3);
        assertTrue(id1 != id3);
    }

    function test_PayForService_UpdatesRegistryUsage() public {
        uint256 calls = 10;
        uint256 expectedTotal = PRICE_PER_CALL * calls;

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        IServiceRegistry.Service memory svc = registry.getService(SERVICE_ID);
        assertEq(svc.totalCalls, calls);
        assertEq(svc.totalRevenue, expectedTotal);
    }

    function test_PayForService_RevertZeroCalls() public {
        vm.prank(payer);
        vm.expectRevert(x402Gateway.ZeroCalls.selector);
        gateway.payForService(SERVICE_ID, 0);
    }

    function test_PayForService_RevertServiceNotFound() public {
        bytes32 unknownId = keccak256("nonexistent");

        vm.prank(payer);
        vm.expectRevert(); // ServiceNotFound from registry
        gateway.payForService(unknownId, 1);
    }

    function test_PayForService_RevertServiceNotActive() public {
        // Deactivate service
        vm.prank(serviceOwner);
        registry.deactivateService(SERVICE_ID);

        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(x402Gateway.ServiceNotActive.selector, SERVICE_ID)
        );
        gateway.payForService(SERVICE_ID, 1);
    }

    function test_PayForService_RevertInsufficientApproval() public {
        // Reset approval to 0
        vm.prank(payer);
        usdc.approve(address(gateway), 0);

        vm.prank(payer);
        vm.expectRevert(); // SafeERC20: ERC20 operation did not succeed / insufficient allowance
        gateway.payForService(SERVICE_ID, 1);
    }

    function test_PayForService_RevertInsufficientBalance() public {
        // Create a payer with no USDC
        address brokePayer = makeAddr("brokePayer");
        vm.prank(brokePayer);
        usdc.approve(address(gateway), type(uint256).max);

        vm.prank(brokePayer);
        vm.expectRevert(); // ERC20: transfer amount exceeds balance
        gateway.payForService(SERVICE_ID, 1);
    }

    // ==================== verifyPayment ====================

    function test_VerifyPayment_ValidPayment() public {
        uint256 calls = 3;
        uint256 expectedTotal = PRICE_PER_CALL * calls;

        vm.prank(payer);
        bytes32 paymentId = gateway.payForService(SERVICE_ID, calls);

        (bool valid, address payerAddr, uint256 amount) = gateway.verifyPayment(paymentId);
        assertTrue(valid);
        assertEq(payerAddr, payer);
        assertEq(amount, expectedTotal);
    }

    function test_VerifyPayment_NonexistentPayment() public view {
        bytes32 fakeId = keccak256("fake-payment");

        (bool valid, address payerAddr, uint256 amount) = gateway.verifyPayment(fakeId);
        assertFalse(valid);
        assertEq(payerAddr, address(0));
        assertEq(amount, 0);
    }

    // ==================== getPayment ====================

    function test_GetPayment_ReturnsFullStruct() public {
        vm.prank(payer);
        bytes32 paymentId = gateway.payForService(SERVICE_ID, 7);

        Ix402Gateway.Payment memory payment = gateway.getPayment(paymentId);
        assertEq(payment.payer, payer);
        assertEq(payment.serviceId, SERVICE_ID);
        assertEq(payment.calls, 7);
        assertEq(payment.amount, PRICE_PER_CALL * 7);
        assertTrue(payment.valid);
    }

    // ==================== Fuzz tests ====================

    function testFuzz_PayForService_VariousCalls(uint256 calls) public {
        // Bound calls to a reasonable range to avoid overflow with price
        calls = bound(calls, 1, 1_000_000);
        uint256 total = PRICE_PER_CALL * calls;

        // Ensure payer has enough
        if (total > usdc.balanceOf(payer)) {
            deal(address(usdc), payer, total);
        }

        vm.prank(payer);
        bytes32 paymentId = gateway.payForService(SERVICE_ID, calls);

        Ix402Gateway.Payment memory payment = gateway.getPayment(paymentId);
        assertEq(payment.amount, total);
        assertTrue(payment.valid);
    }

    // ==================== nonce ====================

    function test_NonceIncrementsOnEachPayment() public {
        assertEq(gateway.nonce(), 0);

        vm.startPrank(payer);
        gateway.payForService(SERVICE_ID, 1);
        assertEq(gateway.nonce(), 1);

        gateway.payForService(SERVICE_ID, 1);
        assertEq(gateway.nonce(), 2);

        gateway.payForService(SERVICE_ID, 1);
        assertEq(gateway.nonce(), 3);
        vm.stopPrank();
    }

    // ==================== PaymentMode tests ====================

    /// @notice PROXY_WRAPPED service splits revenue 40/60 (pool/wallet)
    function test_PayForService_PROXY_WRAPPED_SplitsRevenue() public {
        // The default SERVICE_ID is already registered with PROXY_WRAPPED
        uint256 calls = 10;
        uint256 total = PRICE_PER_CALL * calls;

        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        uint256 expectedPoolShare = (total * 4000) / 10_000; // 40%
        uint256 expectedAgentShare = total - expectedPoolShare; // 60%

        assertEq(usdc.balanceOf(address(pool)), poolBalBefore + expectedPoolShare, "Pool should receive 40%");
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore + expectedAgentShare, "Agent should receive 60%");
    }

    /// @notice Configurable split at 30%
    function test_PayForService_SplitAt30Percent() public {
        // Set agent funding config to 30% split
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, true, 3000);

        uint256 calls = 10;
        uint256 total = PRICE_PER_CALL * calls;

        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        uint256 expectedPoolShare = (total * 3000) / 10_000; // 30%
        uint256 expectedAgentShare = total - expectedPoolShare; // 70%

        assertEq(usdc.balanceOf(address(pool)), poolBalBefore + expectedPoolShare, "Pool should receive 30%");
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore + expectedAgentShare, "Agent should receive 70%");
    }

    /// @notice Configurable split at 50%
    function test_PayForService_SplitAt50Percent() public {
        // Set agent funding config to 50% split
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, true, 5000);

        uint256 calls = 10;
        uint256 total = PRICE_PER_CALL * calls;

        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        uint256 expectedPoolShare = (total * 5000) / 10_000; // 50%
        uint256 expectedAgentShare = total - expectedPoolShare; // 50%

        assertEq(usdc.balanceOf(address(pool)), poolBalBefore + expectedPoolShare, "Pool should receive 50%");
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore + expectedAgentShare, "Agent should receive 50%");
    }

    /// @notice Configurable split at 100% (all to pool)
    function test_PayForService_SplitAt100Percent() public {
        // Set agent funding config to 100% split
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, true, 10000);

        uint256 calls = 10;
        uint256 total = PRICE_PER_CALL * calls;

        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        assertEq(usdc.balanceOf(address(pool)), poolBalBefore + total, "Pool should receive 100%");
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore, "Agent should receive nothing");
    }

    /// @notice Self-funded agent (needsFunding=false) receives 100% to wallet
    function test_PayForService_SelfFunded_FullToWallet() public {
        // Set agent as self-funded
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, false, 4000); // splitRatio ignored when needsFunding=false

        uint256 calls = 10;
        uint256 total = PRICE_PER_CALL * calls;

        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        assertEq(usdc.balanceOf(address(pool)), poolBalBefore, "Pool should receive nothing for self-funded");
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore + total, "Agent should receive 100%");
    }

    /// @notice Self-funded agent ignores splitRatio setting
    function test_PayForService_SelfFunded_IgnoresSplitRatio() public {
        // Set high splitRatio but needsFunding=false
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, false, 9000);

        uint256 calls = 5;
        uint256 total = PRICE_PER_CALL * calls;

        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        // Despite 90% split ratio, self-funded agent gets 100%
        assertEq(usdc.balanceOf(address(pool)), poolBalBefore, "Pool unchanged for self-funded");
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore + total, "Agent receives 100%");
    }

    /// @notice Zero split ratio sends 100% to wallet
    function test_PayForService_ZeroSplitRatio_FullToWallet() public {
        // Set needsFunding=true but splitRatio=0
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, true, 0);

        uint256 calls = 10;
        uint256 total = PRICE_PER_CALL * calls;

        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        assertEq(usdc.balanceOf(address(pool)), poolBalBefore, "Pool receives nothing with zero ratio");
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore + total, "Agent receives 100% with zero ratio");
    }

    /// @notice Config can change between payments
    function test_PayForService_ConfigChangeBetweenPayments() public {
        uint256 calls = 10;
        uint256 total = PRICE_PER_CALL * calls;

        // First payment with 30% split
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, true, 3000);

        uint256 poolBal1 = usdc.balanceOf(address(pool));
        uint256 agentBal1 = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        uint256 poolShare1 = (total * 3000) / 10_000;
        assertEq(usdc.balanceOf(address(pool)), poolBal1 + poolShare1);
        assertEq(usdc.balanceOf(serviceOwner), agentBal1 + (total - poolShare1));

        // Change to 60% split
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, true, 6000);

        uint256 poolBal2 = usdc.balanceOf(address(pool));
        uint256 agentBal2 = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(SERVICE_ID, calls);

        uint256 poolShare2 = (total * 6000) / 10_000;
        assertEq(usdc.balanceOf(address(pool)), poolBal2 + poolShare2, "Pool uses new 60% ratio");
        assertEq(usdc.balanceOf(serviceOwner), agentBal2 + (total - poolShare2), "Agent uses new 40% share");
    }

    /// @notice NATIVE_X402 service still splits based on agent config (not payment mode)
    function test_PayForService_NATIVE_X402_StillSplitsBasedOnAgentConfig() public {
        // Register a NATIVE_X402 service
        bytes32 nativeServiceId = keccak256("native-x402-service");

        vm.prank(serviceOwner);
        registry.registerService(
            nativeServiceId,
            agentId,
            "Native x402 Service",
            PRICE_PER_CALL,
            "https://native.example.com",
            IServiceRegistry.ServiceType.API,
            IServiceRegistry.PaymentMode.NATIVE_X402
        );

        // Agent has needsFunding=true, splitRatio=4000 from setUp
        uint256 calls = 10;
        uint256 total = PRICE_PER_CALL * calls;

        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(nativeServiceId, calls);

        // PaymentMode doesn't affect split - agent config does
        uint256 expectedPoolShare = (total * 4000) / 10_000; // 40%
        uint256 expectedAgentShare = total - expectedPoolShare; // 60%

        assertEq(usdc.balanceOf(address(pool)), poolBalBefore + expectedPoolShare, "Pool receives 40% based on agent config");
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore + expectedAgentShare, "Agent receives 60% based on agent config");
    }

    /// @notice NATIVE_X402 service with self-funded agent sends 100% to wallet
    function test_PayForService_NATIVE_X402_SelfFunded_FullToWallet() public {
        // Register a NATIVE_X402 service using existing agent
        bytes32 nativeServiceId2 = keccak256("native-x402-self-funded");

        vm.prank(serviceOwner);
        registry.registerService(
            nativeServiceId2,
            agentId,
            "Native x402 Self Funded Test",
            PRICE_PER_CALL,
            "https://native-self-funded.example.com",
            IServiceRegistry.ServiceType.API,
            IServiceRegistry.PaymentMode.NATIVE_X402
        );

        // Set agent as self-funded
        vm.prank(serviceOwner);
        agentFactory.setFundingConfig(agentId, false, 0);

        uint256 calls = 5;
        uint256 total = PRICE_PER_CALL * calls;

        uint256 poolBalBefore = usdc.balanceOf(address(pool));
        uint256 agentBalBefore = usdc.balanceOf(serviceOwner);

        vm.prank(payer);
        gateway.payForService(nativeServiceId2, calls);

        // Self-funded agent gets 100%
        assertEq(usdc.balanceOf(address(pool)), poolBalBefore, "Pool balance unchanged for self-funded");
        assertEq(usdc.balanceOf(serviceOwner), agentBalBefore + total, "Agent received 100%");
    }
}
