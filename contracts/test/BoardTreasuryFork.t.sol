// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {BoardTreasury} from "../src/BoardTreasury.sol";

/**
 * @notice Runs a full paid table against the real USDG contract on a fork of
 *         Robinhood Chain mainnet.
 *
 * Testnet carries no USDG at the canonical address, so a testnet run would only
 * exercise a mock. Forking mainnet executes the actual token bytecode, which is
 * what the contract faces in production.
 *
 * Skipped unless ROBINHOOD_RPC is set, so the default suite stays offline:
 *   ROBINHOOD_RPC=https://rpc.mainnet.chain.robinhood.com \
 *     forge test --match-path 'test/BoardTreasuryFork.t.sol' -vv
 */
contract BoardTreasuryForkTest is Test {
    /// Canonical Paxos Global Dollar on Robinhood Chain mainnet.
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    uint256 internal constant ENTRY_FEE = 1_000000;
    uint8 internal constant SEATS = 4;
    uint256 internal constant ESCROW = 4_000000;
    uint256 internal constant PAYOUT = 3_920000;
    uint256 internal constant DEV_CUT = 24000;
    uint256 internal constant BUYBACK_CUT = 28000;
    uint256 internal constant BURN_CUT = 28000;

    IERC20Metadata internal usdg;
    BoardTreasury internal treasury;
    bool internal forked;

    uint256 internal operatorKey = 0xA11CE;
    address internal operator;
    address internal devWallet = address(0xDE0);
    address internal buybackWallet = address(0xB0B);
    address internal burnWallet = address(0xB0A);

    bytes32 internal constant MATCH_ID = keccak256("LUD-FORK-1");
    address[4] internal players;

    function setUp() public {
        string memory rpc = vm.envOr("ROBINHOOD_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;

        usdg = IERC20Metadata(USDG);
        operator = vm.addr(operatorKey);

        treasury = new BoardTreasury(
            USDG,
            ENTRY_FEE,
            SEATS,
            200,
            3000,
            3500,
            2 hours,
            operator,
            devWallet,
            buybackWallet,
            burnWallet,
            address(this)
        );

        for (uint256 i = 0; i < SEATS; i++) {
            players[i] = vm.addr(0x2000 + i);
            deal(USDG, players[i], ENTRY_FEE);
            vm.prank(players[i]);
            usdg.approve(address(treasury), ENTRY_FEE);
        }
    }

    function _sign(address winner) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(treasury.RESULT_TYPEHASH(), MATCH_ID, winner));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", treasury.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(operatorKey, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @notice The token on chain must match what the design assumed.
    function test_RealUsdgMetadataMatchesTheDesign() public {
        vm.skip(!forked);
        assertEq(usdg.decimals(), 6, "USDG decimals");
        assertEq(usdg.symbol(), "USDG", "USDG symbol");
    }

    function test_FullTableAgainstRealUsdg() public {
        vm.skip(!forked);

        for (uint256 i = 0; i < SEATS; i++) {
            vm.prank(players[i]);
            treasury.join(MATCH_ID);
        }

        assertEq(uint8(treasury.statusOf(MATCH_ID)), uint8(BoardTreasury.Status.Playing));
        assertEq(usdg.balanceOf(address(treasury)), ESCROW, "escrow held");

        address winner = players[2];
        treasury.settle(MATCH_ID, winner, _sign(winner));

        assertEq(usdg.balanceOf(winner), PAYOUT, "winner paid");
        assertEq(usdg.balanceOf(devWallet), DEV_CUT, "development share");
        assertEq(usdg.balanceOf(buybackWallet), BUYBACK_CUT, "buyback share");
        assertEq(usdg.balanceOf(burnWallet), BURN_CUT, "burn share");
        assertEq(usdg.balanceOf(address(treasury)), 0, "no dust left");
    }

    function test_TimeoutRefundsAgainstRealUsdg() public {
        vm.skip(!forked);

        for (uint256 i = 0; i < SEATS; i++) {
            vm.prank(players[i]);
            treasury.join(MATCH_ID);
        }

        vm.warp(block.timestamp + 2 hours + 1);
        vm.prank(players[0]);
        treasury.timeout(MATCH_ID);

        for (uint256 i = 0; i < SEATS; i++) {
            assertEq(usdg.balanceOf(players[i]), ENTRY_FEE, "entry returned");
        }
        assertEq(usdg.balanceOf(address(treasury)), 0, "escrow drained");
    }
}
