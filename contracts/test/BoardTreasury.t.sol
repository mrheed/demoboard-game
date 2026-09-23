// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {BoardTreasury} from "../src/BoardTreasury.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

contract BoardTreasuryTest is Test {
    MockUSDG internal usdg;
    BoardTreasury internal treasury;

    uint256 internal constant ENTRY_FEE = 1_000000; // 1 USDG, six decimals
    uint8 internal constant SEATS = 4;
    uint16 internal constant FEE_BPS = 200; // 2%
    uint16 internal constant DEV_BPS = 3000;
    uint16 internal constant BUYBACK_BPS = 3500;
    uint64 internal constant SETTLE_DEADLINE = 2 hours;

    // Expected money math for one full table.
    uint256 internal constant ESCROW = 4_000000; // 4.00
    uint256 internal constant FEE = 80000; // 0.08
    uint256 internal constant PAYOUT = 3_920000; // 3.92
    uint256 internal constant DEV_CUT = 24000; // 0.024
    uint256 internal constant BUYBACK_CUT = 28000; // 0.028
    uint256 internal constant BURN_CUT = 28000; // 0.028

    uint256 internal operatorKey = 0xA11CE;
    address internal operator;
    address internal owner = address(0x0111);
    address internal devWallet = address(0xDE0);
    address internal buybackWallet = address(0xB0B);
    address internal burnWallet = address(0xB0A);

    bytes32 internal constant MATCH_ID = keccak256("LUD-0001");

    address[4] internal players;
    uint256[4] internal playerKeys;

    function setUp() public {
        operator = vm.addr(operatorKey);
        usdg = new MockUSDG();

        treasury = new BoardTreasury(
            address(usdg),
            ENTRY_FEE,
            SEATS,
            FEE_BPS,
            DEV_BPS,
            BUYBACK_BPS,
            SETTLE_DEADLINE,
            operator,
            devWallet,
            buybackWallet,
            burnWallet,
            owner
        );

        for (uint256 i = 0; i < SEATS; i++) {
            playerKeys[i] = 0x1000 + i;
            players[i] = vm.addr(playerKeys[i]);
            usdg.mint(players[i], 10_000000);
            vm.prank(players[i]);
            usdg.approve(address(treasury), type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- helpers

    function _join(uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            vm.prank(players[i]);
            treasury.join(MATCH_ID);
        }
    }

    function _resultDigest(bytes32 matchId, address winner) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(treasury.RESULT_TYPEHASH(), matchId, winner));
        return keccak256(abi.encodePacked("\x19\x01", treasury.domainSeparator(), structHash));
    }

    function _sign(uint256 key, bytes32 matchId, address winner)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _resultDigest(matchId, winner));
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ start

    function test_FourthJoinStartsMatchAndEscrowsExactly() public {
        _join(3);
        assertEq(uint8(treasury.statusOf(MATCH_ID)), uint8(BoardTreasury.Status.Filling));

        vm.prank(players[3]);
        treasury.join(MATCH_ID);

        assertEq(uint8(treasury.statusOf(MATCH_ID)), uint8(BoardTreasury.Status.Playing));
        assertEq(usdg.balanceOf(address(treasury)), ESCROW);
    }

    function test_JoinRejectsDuplicateAddress() public {
        _join(1);
        vm.prank(players[0]);
        vm.expectRevert(BoardTreasury.AlreadySeated.selector);
        treasury.join(MATCH_ID);
    }

    function test_JoinRejectsFullMatch() public {
        _join(4);
        address outsider = vm.addr(0x9999);
        usdg.mint(outsider, ENTRY_FEE);
        vm.startPrank(outsider);
        usdg.approve(address(treasury), ENTRY_FEE);
        vm.expectRevert(BoardTreasury.MatchNotOpen.selector);
        treasury.join(MATCH_ID);
        vm.stopPrank();
    }

    function test_JoinRejectsSettledMatch() public {
        _join(4);
        treasury.settle(MATCH_ID, players[0], _sign(operatorKey, MATCH_ID, players[0]));

        vm.prank(players[1]);
        vm.expectRevert(BoardTreasury.MatchNotOpen.selector);
        treasury.join(MATCH_ID);
    }

    // --------------------------------------------------------------- withdraw

    function test_WithdrawReturnsOwnEntryWhileFilling() public {
        _join(2);
        uint256 before = usdg.balanceOf(players[1]);

        vm.prank(players[1]);
        treasury.withdraw(MATCH_ID);

        assertEq(usdg.balanceOf(players[1]), before + ENTRY_FEE);
        assertEq(usdg.balanceOf(address(treasury)), ENTRY_FEE);
    }

    function test_WithdrawRevertsOncePlaying() public {
        _join(4);
        vm.prank(players[0]);
        vm.expectRevert(BoardTreasury.MatchNotOpen.selector);
        treasury.withdraw(MATCH_ID);
    }

    // ----------------------------------------------------------------- settle

    function test_SettlePaysWinnerAndSplitsFee() public {
        _join(4);
        uint256 before = usdg.balanceOf(players[2]);

        treasury.settle(MATCH_ID, players[2], _sign(operatorKey, MATCH_ID, players[2]));

        assertEq(usdg.balanceOf(players[2]), before + PAYOUT);
        assertEq(usdg.balanceOf(devWallet), DEV_CUT);
        assertEq(usdg.balanceOf(buybackWallet), BUYBACK_CUT);
        assertEq(usdg.balanceOf(burnWallet), BURN_CUT);
        assertEq(DEV_CUT + BUYBACK_CUT + BURN_CUT, FEE);
    }

    function test_SettleLeavesNoDustInContract() public {
        _join(4);
        treasury.settle(MATCH_ID, players[1], _sign(operatorKey, MATCH_ID, players[1]));
        assertEq(usdg.balanceOf(address(treasury)), 0);
    }

    function test_SettleRevertsWhenWinnerNotSeated() public {
        _join(4);
        address outsider = vm.addr(0x9999);
        // Signed before expectRevert: _sign reads the contract, and the cheatcode
        // would otherwise attach to that view call instead of settle.
        bytes memory sig = _sign(operatorKey, MATCH_ID, outsider);
        vm.expectRevert(BoardTreasury.WinnerNotSeated.selector);
        treasury.settle(MATCH_ID, outsider, sig);
    }

    function test_SettleRevertsOnNonOperatorSignature() public {
        _join(4);
        bytes memory sig = _sign(playerKeys[0], MATCH_ID, players[0]);
        vm.expectRevert(BoardTreasury.BadSignature.selector);
        treasury.settle(MATCH_ID, players[0], sig);
    }

    function test_SettleRevertsOnSignatureForAnotherMatch() public {
        _join(4);
        bytes memory wrong = _sign(operatorKey, keccak256("LUD-9999"), players[0]);
        vm.expectRevert(BoardTreasury.BadSignature.selector);
        treasury.settle(MATCH_ID, players[0], wrong);
    }

    function test_SettleRevertsOnSignatureForAnotherContract() public {
        _join(4);
        bytes memory sig = _sign(operatorKey, MATCH_ID, players[0]);

        // A second deployment shares the operator but not the verifying contract.
        BoardTreasury other = new BoardTreasury(
            address(usdg),
            ENTRY_FEE,
            SEATS,
            FEE_BPS,
            DEV_BPS,
            BUYBACK_BPS,
            SETTLE_DEADLINE,
            operator,
            devWallet,
            buybackWallet,
            burnWallet,
            owner
        );
        for (uint256 i = 0; i < SEATS; i++) {
            vm.startPrank(players[i]);
            usdg.approve(address(other), type(uint256).max);
            other.join(MATCH_ID);
            vm.stopPrank();
        }

        vm.expectRevert(BoardTreasury.BadSignature.selector);
        other.settle(MATCH_ID, players[0], sig);
    }

    function test_SettleRevertsOnSecondCall() public {
        _join(4);
        bytes memory sig = _sign(operatorKey, MATCH_ID, players[0]);
        treasury.settle(MATCH_ID, players[0], sig);

        vm.expectRevert(BoardTreasury.MatchNotPlaying.selector);
        treasury.settle(MATCH_ID, players[0], sig);
    }

    // ---------------------------------------------------------------- timeout

    function test_TimeoutRevertsBeforeDeadline() public {
        _join(4);
        vm.warp(block.timestamp + SETTLE_DEADLINE - 1);
        vm.prank(players[0]);
        vm.expectRevert(BoardTreasury.DeadlineNotReached.selector);
        treasury.timeout(MATCH_ID);
    }

    function test_TimeoutRefundsEveryoneInFullAndTakesNoFee() public {
        _join(4);
        uint256[4] memory before;
        for (uint256 i = 0; i < SEATS; i++) {
            before[i] = usdg.balanceOf(players[i]);
        }

        vm.warp(block.timestamp + SETTLE_DEADLINE + 1);
        vm.prank(players[0]);
        treasury.timeout(MATCH_ID);

        for (uint256 i = 0; i < SEATS; i++) {
            assertEq(usdg.balanceOf(players[i]), before[i] + ENTRY_FEE);
        }
        assertEq(usdg.balanceOf(devWallet), 0);
        assertEq(usdg.balanceOf(buybackWallet), 0);
        assertEq(usdg.balanceOf(burnWallet), 0);
        assertEq(usdg.balanceOf(address(treasury)), 0);
    }

    function test_TimeoutRejectsNonSeatedCaller() public {
        _join(4);
        vm.warp(block.timestamp + SETTLE_DEADLINE + 1);
        vm.prank(vm.addr(0x9999));
        vm.expectRevert(BoardTreasury.NotSeated.selector);
        treasury.timeout(MATCH_ID);
    }

    // ------------------------------------------------- settle by players

    function _allPlayerSigs(address winner) internal view returns (bytes[] memory sigs) {
        sigs = new bytes[](SEATS);
        for (uint256 i = 0; i < SEATS; i++) {
            sigs[i] = _sign(playerKeys[i], MATCH_ID, winner);
        }
    }

    function test_FourPlayerSignaturesSettleWithoutOperator() public {
        _join(4);
        uint256 before = usdg.balanceOf(players[3]);

        // The operator key signs nothing here.
        treasury.settleByPlayers(MATCH_ID, players[3], _allPlayerSigs(players[3]));

        assertEq(usdg.balanceOf(players[3]), before + PAYOUT);
        assertEq(usdg.balanceOf(devWallet), DEV_CUT);
        assertEq(usdg.balanceOf(address(treasury)), 0);
        assertEq(uint8(treasury.statusOf(MATCH_ID)), uint8(BoardTreasury.Status.Settled));
    }

    function test_SettleByPlayersRejectsShortSignatureSet() public {
        _join(4);
        bytes[] memory sigs = new bytes[](SEATS - 1);
        for (uint256 i = 0; i < SEATS - 1; i++) {
            sigs[i] = _sign(playerKeys[i], MATCH_ID, players[0]);
        }

        vm.expectRevert(BoardTreasury.NotAllPlayersSigned.selector);
        treasury.settleByPlayers(MATCH_ID, players[0], sigs);
    }

    function test_SettleByPlayersRejectsDuplicateSigner() public {
        _join(4);
        bytes[] memory sigs = _allPlayerSigs(players[0]);
        // Seat 3 replaced by a second signature from seat 0.
        sigs[3] = _sign(playerKeys[0], MATCH_ID, players[0]);

        vm.expectRevert(BoardTreasury.DuplicateSigner.selector);
        treasury.settleByPlayers(MATCH_ID, players[0], sigs);
    }

    function test_SettleByPlayersRejectsOutsiderSignature() public {
        _join(4);
        bytes[] memory sigs = _allPlayerSigs(players[0]);
        sigs[2] = _sign(0x9999, MATCH_ID, players[0]);

        vm.expectRevert(BoardTreasury.BadSignature.selector);
        treasury.settleByPlayers(MATCH_ID, players[0], sigs);
    }

    function test_SettleByPlayersRejectsUnseatedWinner() public {
        _join(4);
        address outsider = vm.addr(0x9999);
        bytes[] memory sigs = _allPlayerSigs(outsider);

        vm.expectRevert(BoardTreasury.WinnerNotSeated.selector);
        treasury.settleByPlayers(MATCH_ID, outsider, sigs);
    }

    // ------------------------------------------------------- split invariant

    /// @dev Conservation matters more than any single example: nothing may be
    ///      created or stranded, whatever the fee and split happen to be.
    function testFuzz_SplitConservesEscrow(uint16 feeBps_, uint16 devBps_, uint16 buybackBps_)
        public
    {
        feeBps_ = uint16(bound(feeBps_, 0, 9_999));
        devBps_ = uint16(bound(devBps_, 0, 10_000));
        buybackBps_ = uint16(bound(buybackBps_, 0, 10_000 - devBps_));

        BoardTreasury t = new BoardTreasury(
            address(usdg),
            ENTRY_FEE,
            SEATS,
            feeBps_,
            devBps_,
            buybackBps_,
            SETTLE_DEADLINE,
            operator,
            devWallet,
            buybackWallet,
            burnWallet,
            owner
        );

        for (uint256 i = 0; i < SEATS; i++) {
            vm.startPrank(players[i]);
            usdg.approve(address(t), type(uint256).max);
            t.join(MATCH_ID);
            vm.stopPrank();
        }

        uint256 winnerBefore = usdg.balanceOf(players[0]);
        bytes32 structHash = keccak256(abi.encode(t.RESULT_TYPEHASH(), MATCH_ID, players[0]));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", t.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 sConv) = vm.sign(operatorKey, digest);
        t.settle(MATCH_ID, players[0], abi.encodePacked(r, sConv, v));

        uint256 paid = usdg.balanceOf(players[0]) - winnerBefore;
        uint256 fees =
            usdg.balanceOf(devWallet) + usdg.balanceOf(buybackWallet) + usdg.balanceOf(burnWallet);

        assertEq(paid + fees, ENTRY_FEE * SEATS, "escrow must be fully distributed");
        assertEq(usdg.balanceOf(address(t)), 0, "no dust may remain");
    }

    // ------------------------------------------------------------ owner scope

    function test_OwnerCanRotateOperator() public {
        address next = vm.addr(0xBEEF);
        vm.prank(owner);
        treasury.setOperator(next);
        assertEq(treasury.operator(), next);
    }

    function test_NonOwnerCannotRotateOperator() public {
        vm.prank(players[0]);
        vm.expectRevert();
        treasury.setOperator(address(0xBEEF));
    }

    function test_RatesAreImmutable() public view {
        // No setter exists for the economics; assert the deployed values stand.
        assertEq(treasury.entryFee(), ENTRY_FEE);
        assertEq(treasury.seats(), SEATS);
        assertEq(treasury.feeBps(), FEE_BPS);
        assertEq(treasury.devBps(), DEV_BPS);
        assertEq(treasury.buybackBps(), BUYBACK_BPS);
        assertEq(treasury.settleDeadline(), SETTLE_DEADLINE);
    }
}
