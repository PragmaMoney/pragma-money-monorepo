// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {AgentPool} from "../src/Launchpad/AgentPool.sol";
import {Errors} from "../src/errors/Errors.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BaseTest} from "./BaseTest.t.sol";

contract AgentPoolTest is BaseTest {
    AgentPool internal pool;

    function setUp() public {
        ( , , , pool, ) = deployAll();
    }

    /// @notice deposit mints shares and increases total assets
    function test_deposit_mintsShares_and_updatesTotalAssets() public {
        uint256 amount = 1000e6;
        _fundAndApprove(alice, pool, amount);

        vm.prank(alice);
        uint256 shares = pool.deposit(amount, alice);

        assertGt(shares, 0);
        assertEq(pool.totalAssets(), amount);
        assertEq(pool.previewDeposit(amount), shares);
    }

    /// @notice withdraw burns shares and transfers assets
    function test_withdraw_burnsShares_and_transfersAssets() public {
        uint256 amount = 1000e6;
        _fundAndApprove(alice, pool, amount);
        vm.prank(alice);
        pool.deposit(amount, alice);

        vm.warp(block.timestamp + 8 days);

        vm.prank(alice);
        uint256 sharesBurned = pool.withdraw(100e6, alice, alice);
        assertGt(sharesBurned, 0);
        assertEq(pool.totalAssets(), amount - 100e6);
    }

    /// @notice redeem full burns shares and returns assets
    function test_redeem_fullBurn_returnsAssets() public {
        uint256 amount = 500e6;
        _fundAndApprove(alice, pool, amount);
        vm.prank(alice);
        uint256 shares = pool.deposit(amount, alice);

        vm.warp(block.timestamp + 8 days);

        vm.prank(alice);
        uint256 assetsOut = pool.redeem(shares, alice, alice);
        assertEq(assetsOut, amount);
        assertEq(pool.totalSupply(), 0);
    }

    /// @notice exchange rate increases when yield is added
    function test_exchangeRate_totalAssets_over_totalSupply() public {
        uint256 amount = 1000e6;
        _fundAndApprove(alice, pool, amount);
        vm.prank(alice);
        uint256 shares = pool.deposit(amount, alice);

        // Simulate yield by transferring assets directly to vault
        uint256 beforeBal = usdc.balanceOf(address(pool));
        deal(address(usdc), address(pool), beforeBal + 500e6);

        uint256 assets = pool.convertToAssets(shares);
        assertEq(pool.totalAssets(), amount + 500e6);
        assertApproxEqAbs(assets, pool.totalAssets(), 1);
    }

    /// @notice vesting prevents early withdraw
    function test_vesting_prevents_early_withdraw_if_enabled() public {
        uint256 amount = 1000e6;
        _fundAndApprove(alice, pool, amount);
        vm.prank(alice);
        pool.deposit(amount, alice);

        vm.prank(alice);
        vm.expectRevert(bytes("locked"));
        pool.withdraw(1e6, alice, alice);

        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        pool.withdraw(1e6, alice, alice);
    }

    /// @notice agent pull within daily cap succeeds
    function test_agentPull_withinDailyCap_succeeds() public {
        deal(address(usdc), address(pool), 200e6);

        vm.prank(agentOwner);
        pool.pull(bob, 100e6);

        assertEq(pool.remainingCapToday(), 0);
    }

    /// @notice agent pull exceeding cap reverts
    function test_agentPull_exceedDailyCap_reverts() public {
        deal(address(usdc), address(pool), 200e6);

        vm.prank(agentOwner);
        vm.expectRevert(Errors.CapExceeded.selector);
        pool.pull(bob, 101e6);
    }

    /// @notice daily cap resets next day
    function test_agentPull_resetsNextDay() public {
        deal(address(usdc), address(pool), 200e6);

        vm.prank(agentOwner);
        pool.pull(bob, 100e6);

        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(agentOwner);
        pool.pull(bob, 100e6);
    }

    /// @notice revoke blocks pulls
    function test_revokeAgent_blocksPulls() public {
        deal(address(usdc), address(pool), 200e6);

        vm.prank(deployer);
        pool.revokeAgent();

        vm.prank(agentOwner);
        vm.expectRevert(Errors.AgentRevokedError.selector);
        pool.pull(bob, 1e6);
    }

    /// @notice only agent can pull
    function test_onlyAgent_canPull() public {
        deal(address(usdc), address(pool), 200e6);

        vm.prank(alice);
        vm.expectRevert(Errors.NotAgent.selector);
        pool.pull(bob, 1e6);
    }

    /// @notice only owner (auth) can set caps and revoke
    function test_onlyOwner_can_setCaps_and_revoke() public {
        vm.prank(alice);
        vm.expectRevert(Errors.NotAuthorized.selector);
        pool.setDailyCap(1);

        vm.prank(deployer);
        pool.setDailyCap(123e6);

        vm.prank(alice);
        vm.expectRevert(Errors.NotAuthorized.selector);
        pool.revokeAgent();
    }

    // ==================== contribute() tests ====================

    /// @notice contribute with valid amount increases total assets without minting shares
    function test_contribute_validAmount_increasesTotalAssets() public {
        uint256 amount = 100e6;
        _fundAndApprove(alice, pool, amount);

        uint256 totalAssetsBefore = pool.totalAssets();
        uint256 totalSupplyBefore = pool.totalSupply();

        vm.prank(alice);
        pool.contribute(amount);

        assertEq(pool.totalAssets(), totalAssetsBefore + amount, "totalAssets should increase");
        assertEq(pool.totalSupply(), totalSupplyBefore, "totalSupply should not change (no shares minted)");
    }

    /// @notice contribute with zero amount reverts
    function test_contribute_zeroAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert(Errors.ZeroAmount.selector);
        pool.contribute(0);
    }

    /// @notice contribute emits Contributed event
    function test_contribute_emitsContributedEvent() public {
        uint256 amount = 100e6;
        _fundAndApprove(alice, pool, amount);

        vm.expectEmit(true, true, false, true);
        emit AgentPool.Contributed(alice, amount);

        vm.prank(alice);
        pool.contribute(amount);
    }

    /// @notice contribute increases share value for existing depositors
    function test_contribute_increasesShareValue() public {
        // Alice deposits 1000 USDC, gets shares
        uint256 depositAmount = 1000e6;
        _fundAndApprove(alice, pool, depositAmount);

        vm.prank(alice);
        uint256 aliceShares = pool.deposit(depositAmount, alice);

        // Initial share value
        uint256 valueBeforeContribute = pool.convertToAssets(aliceShares);
        assertEq(valueBeforeContribute, depositAmount, "Initial value should equal deposit");

        // Bob contributes 500 USDC (appreciation for investors)
        uint256 contributeAmount = 500e6;
        _fundAndApprove(bob, pool, contributeAmount);

        vm.prank(bob);
        pool.contribute(contributeAmount);

        // Alice's shares now worth more (allow 1 wei rounding error from ERC-4626)
        uint256 valueAfterContribute = pool.convertToAssets(aliceShares);
        assertApproxEqAbs(valueAfterContribute, depositAmount + contributeAmount, 1, "Share value should increase by contribution");
        assertEq(pool.totalAssets(), depositAmount + contributeAmount, "Total assets should reflect contribution");
    }
}
