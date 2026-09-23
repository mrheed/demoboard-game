// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title BoardTreasury
 * @notice Per-match escrow for paid BOARD tables.
 *
 * Players fund their own seat, so the contract counts a table from its own
 * storage and needs no oracle to know a match started. It cannot know who won,
 * so a result is attested by the operator. What the operator may assert is
 * deliberately narrow: `settle` accepts only a winner already seated in that
 * match, and every amount is derived from immutable rates. A stolen operator
 * key can pick a different winner among the four payers; it cannot move escrow,
 * change the fee, or pay an outside address.
 */
contract BoardTreasury is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        Empty,
        Filling,
        Playing,
        Settled,
        Refunded
    }

    struct Match {
        Status status;
        uint64 startedAt;
        address[] players;
    }

    error MatchNotOpen();
    error MatchNotPlaying();
    error AlreadySeated();
    error NotSeated();
    error WinnerNotSeated();
    error BadSignature();
    error DeadlineNotReached();
    error InvalidConfig();
    error ZeroAddress();
    error NotAllPlayersSigned();
    error DuplicateSigner();

    event SeatJoined(bytes32 indexed matchId, address indexed player, uint8 seat);
    event SeatWithdrawn(bytes32 indexed matchId, address indexed player);
    event MatchStarted(bytes32 indexed matchId, uint256 escrow);
    event MatchSettled(
        bytes32 indexed matchId, address indexed winner, uint256 payout, uint256 fee
    );
    event MatchRefunded(bytes32 indexed matchId, uint256 perPlayer);
    event OperatorChanged(address indexed previous, address indexed next);
    event FeeWalletsChanged(address dev, address buyback, address burn);

    bytes32 public constant RESULT_TYPEHASH = keccak256("Result(bytes32 matchId,address winner)");

    uint16 private constant BPS = 10_000;

    IERC20 public immutable stake;
    uint256 public immutable entryFee;
    uint8 public immutable seats;
    uint16 public immutable feeBps;
    uint16 public immutable devBps;
    uint16 public immutable buybackBps;
    uint64 public immutable settleDeadline;

    address public operator;
    address public devWallet;
    address public buybackWallet;
    address public burnWallet;

    mapping(bytes32 => Match) private _matches;

    constructor(
        address stake_,
        uint256 entryFee_,
        uint8 seats_,
        uint16 feeBps_,
        uint16 devBps_,
        uint16 buybackBps_,
        uint64 settleDeadline_,
        address operator_,
        address devWallet_,
        address buybackWallet_,
        address burnWallet_,
        address owner_
    ) EIP712("BoardTreasury", "1") Ownable(owner_) {
        if (stake_ == address(0)) revert ZeroAddress();
        if (entryFee_ == 0 || seats_ < 2) revert InvalidConfig();
        // A fee at or above 100% would leave the winner nothing.
        if (feeBps_ >= BPS) revert InvalidConfig();
        // The burn share is the remainder, so these two must leave room for it.
        if (uint256(devBps_) + buybackBps_ > BPS) revert InvalidConfig();
        if (settleDeadline_ == 0) revert InvalidConfig();

        stake = IERC20(stake_);
        entryFee = entryFee_;
        seats = seats_;
        feeBps = feeBps_;
        devBps = devBps_;
        buybackBps = buybackBps_;
        settleDeadline = settleDeadline_;

        _setOperator(operator_);
        _setFeeWallets(devWallet_, buybackWallet_, burnWallet_);
    }

    // ------------------------------------------------------------------ views

    /// @notice Remainder of the fee after the development and buyback shares.
    function burnBps() public view returns (uint16) {
        return BPS - devBps - buybackBps;
    }

    function statusOf(bytes32 matchId) external view returns (Status) {
        return _matches[matchId].status;
    }

    function playersOf(bytes32 matchId) external view returns (address[] memory) {
        return _matches[matchId].players;
    }

    function startedAtOf(bytes32 matchId) external view returns (uint64) {
        return _matches[matchId].startedAt;
    }

    /// @notice Exposed so a signer can build the EIP-712 digest off-chain.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ seats

    /**
     * @notice Fund a seat. The caller must approve `entryFee` first.
     * @dev The fourth seat starts the match in the same transaction.
     */
    function join(bytes32 matchId) external nonReentrant {
        Match storage game = _matches[matchId];
        if (game.status != Status.Empty && game.status != Status.Filling) revert MatchNotOpen();
        if (_seatIndex(game, msg.sender) != type(uint256).max) revert AlreadySeated();

        game.status = Status.Filling;
        game.players.push(msg.sender);
        emit SeatJoined(matchId, msg.sender, uint8(game.players.length - 1));

        if (game.players.length == seats) {
            game.status = Status.Playing;
            game.startedAt = uint64(block.timestamp);
            emit MatchStarted(matchId, entryFee * seats);
        }

        stake.safeTransferFrom(msg.sender, address(this), entryFee);
    }

    /// @notice Recover your own entry while the table is still filling.
    function withdraw(bytes32 matchId) external nonReentrant {
        Match storage game = _matches[matchId];
        if (game.status != Status.Filling) revert MatchNotOpen();

        uint256 index = _seatIndex(game, msg.sender);
        if (index == type(uint256).max) revert NotSeated();

        uint256 last = game.players.length - 1;
        if (index != last) game.players[index] = game.players[last];
        game.players.pop();
        if (game.players.length == 0) game.status = Status.Empty;

        emit SeatWithdrawn(matchId, msg.sender);
        stake.safeTransfer(msg.sender, entryFee);
    }

    // --------------------------------------------------------------- outcomes

    /**
     * @notice Pay the winner and split the fee, on an operator-signed result.
     * @dev The winner must already hold a seat, so the signature selects among
     *      the payers rather than naming an arbitrary recipient.
     */
    function settle(bytes32 matchId, address winner, bytes calldata operatorSig)
        external
        nonReentrant
    {
        Match storage game = _matches[matchId];
        if (game.status != Status.Playing) revert MatchNotPlaying();
        if (_seatIndex(game, winner) == type(uint256).max) revert WinnerNotSeated();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RESULT_TYPEHASH, matchId, winner)));
        if (ECDSA.recover(digest, operatorSig) != operator) revert BadSignature();

        _payout(matchId, game, winner);
    }

    /**
     * @notice Settle on a result every seated player signed, with no operator.
     * @dev The escape hatch from trusting the operator: when the table agrees
     *      on the winner, the signature set alone is sufficient proof. Each
     *      seat must sign exactly once, tracked by a bitmask of seat indexes.
     */
    function settleByPlayers(bytes32 matchId, address winner, bytes[] calldata playerSigs)
        external
        nonReentrant
    {
        Match storage game = _matches[matchId];
        if (game.status != Status.Playing) revert MatchNotPlaying();
        if (_seatIndex(game, winner) == type(uint256).max) revert WinnerNotSeated();
        if (playerSigs.length != game.players.length) revert NotAllPlayersSigned();

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(RESULT_TYPEHASH, matchId, winner)));

        // One flag per seat. The length check above means `seat` is always a
        // valid index here.
        bool[] memory signed = new bool[](playerSigs.length);
        for (uint256 i = 0; i < playerSigs.length; i++) {
            uint256 seat = _seatIndex(game, ECDSA.recover(digest, playerSigs[i]));
            if (seat == type(uint256).max) revert BadSignature();
            if (signed[seat]) revert DuplicateSigner();
            signed[seat] = true;
        }

        _payout(matchId, game, winner);
    }

    /// @notice Refund every seat when no result arrived before the deadline.
    function timeout(bytes32 matchId) external nonReentrant {
        Match storage game = _matches[matchId];
        if (game.status != Status.Playing) revert MatchNotPlaying();
        if (block.timestamp < uint256(game.startedAt) + settleDeadline) {
            revert DeadlineNotReached();
        }
        if (_seatIndex(game, msg.sender) == type(uint256).max) revert NotSeated();

        game.status = Status.Refunded;

        uint256 count = game.players.length;
        emit MatchRefunded(matchId, entryFee);
        for (uint256 i = 0; i < count; i++) {
            stake.safeTransfer(game.players[i], entryFee);
        }
    }

    // ------------------------------------------------------------------ admin

    function setOperator(address next) external onlyOwner {
        _setOperator(next);
    }

    function setFeeWallets(address dev, address buyback, address burn) external onlyOwner {
        _setFeeWallets(dev, buyback, burn);
    }

    // --------------------------------------------------------------- internal

    /// @dev `type(uint256).max` means absent, so seat 0 stays a valid index.
    function _seatIndex(Match storage game, address who) private view returns (uint256) {
        uint256 count = game.players.length;
        for (uint256 i = 0; i < count; i++) {
            if (game.players[i] == who) return i;
        }
        return type(uint256).max;
    }

    function _payout(bytes32 matchId, Match storage game, address winner) private {
        game.status = Status.Settled;

        uint256 escrow = entryFee * game.players.length;
        uint256 fee = (escrow * feeBps) / BPS;
        uint256 payout = escrow - fee;
        uint256 dev = (fee * devBps) / BPS;
        uint256 buyback = (fee * buybackBps) / BPS;
        // Remainder rather than a third multiplication, so rounding dust cannot
        // be stranded in the contract.
        uint256 burn = fee - dev - buyback;

        emit MatchSettled(matchId, winner, payout, fee);

        stake.safeTransfer(winner, payout);
        if (dev > 0) stake.safeTransfer(devWallet, dev);
        if (buyback > 0) stake.safeTransfer(buybackWallet, buyback);
        if (burn > 0) stake.safeTransfer(burnWallet, burn);
    }

    function _setOperator(address next) private {
        if (next == address(0)) revert ZeroAddress();
        emit OperatorChanged(operator, next);
        operator = next;
    }

    function _setFeeWallets(address dev, address buyback, address burn) private {
        if (dev == address(0) || buyback == address(0) || burn == address(0)) revert ZeroAddress();
        devWallet = dev;
        buybackWallet = buyback;
        burnWallet = burn;
        emit FeeWalletsChanged(dev, buyback, burn);
    }
}
