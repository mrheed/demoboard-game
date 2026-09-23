# BoardTreasury contract design

Status: approved design, not yet implemented
Date: 2026-09-23

## Why

Paid play today is custodial. Every entry lands in one hot wallet controlled by
`PLAY_TREASURY_PRIVATE_KEY` (`src/server/lib/play-chain.ts:80-82`), and payouts
are signed by that same key. Three consequences:

1. A leak of that env var drains every seated entry. There is no escrow
   boundary, no limit, and no second signer.
2. Player float and accumulated fees sit in the same balance with no on-chain
   distinction, so revenue cannot be proven or reconciled from the chain.
3. The 2% fee and the 30/35/35 split are asserted in `economy.service.ts:47-57`
   and in the FAQ, but nothing executes them. `recordTreasuryFee`,
   `recordBuybackFee` and `recordBurnFee` are called only from
   `reward-payout.service.ts`, the dormant off-chain path.

A contract fixes all three: escrow per match, rates that a compromised key
cannot alter, and a split executed at payout.

## What the contract can and cannot know

Match **start** is natively verifiable. Players transfer the entry themselves,
so the contract can count funded seats from its own storage.

Match **end** is not. The chain cannot evaluate Ludo rules, so a result must be
attested. The design therefore spends its effort on bounding what the attester
is allowed to say.

## Decisions

| Decision | Choice |
| --- | --- |
| End-of-match proof | Operator EIP-712 signature; four player signatures accepted as an alternative |
| Non-settlement | Player self-refund before start; any seated player may trigger a full timeout refund after the deadline |
| Mid-match quit | Forfeits, matching `play-table.service.ts:1083` |
| Integration depth | Contract owns escrow and seat membership; the server reads events |

## Parameters

Immutable, set at deployment. A compromised operator or owner key cannot change
them.

| Name | Value | Note |
| --- | --- | --- |
| `stake` | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Canonical USDG, 6 decimals |
| `entryFee` | `1_000000` | 1 USDG, from `PLAY_ENTRY_FEE_USDG` |
| `seats` | `4` | from `MAX_PLAYERS_PER_ROOM` |
| `feeBps` | `200` | 2%, from `PRIZE_FEE_RATE` |
| `devBps` | `3000` | share of the fee |
| `buybackBps` | `3500` | share of the fee |
| `burnBps` | `3500` | share of the fee, taken as the remainder |
| `settleDeadline` | `2 hours` | after `startedAt`, unlocks `timeout()` |

Mutable, owner only: `operator`, `devWallet`, `buybackWallet`, `burnWallet`.

`settleDeadline` is immutable on purpose. If an owner could lower it to zero,
anyone could time out a live match and refund the table, cancelling the fee.
That is griefing rather than theft, but it is cheap to remove entirely.

## Money math

A full table, all values in USDG atomic units:

```
escrow   = entryFee * seats        = 4_000000     (4.00)
fee      = escrow * 200 / 10000    =    80000     (0.08)
payout   = escrow - fee            = 3_920000     (3.92)
dev      = fee * 3000 / 10000      =    24000     (0.024)
buyback  = fee * 3500 / 10000      =    28000     (0.028)
burn     = fee - dev - buyback     =    28000     (0.028)
```

`burn` is the remainder rather than a third multiplication, so rounding dust can
never be stranded in the contract.

## State machine

```
Empty ──join()──► Filling ──join() fills seats──► Playing
                     │                              │
              withdraw()                     settle() │ timeout()
                     ▼                              ▼      ▼
                  Filling                       Settled  Refunded
              (own entry returned)
```

`Settled` and `Refunded` are terminal. All transitions require the current
status, so no path can run twice.

## Interface

```solidity
function join(bytes32 matchId) external;
function withdraw(bytes32 matchId) external;
function settle(bytes32 matchId, address winner, bytes calldata operatorSig) external;
function settleByPlayers(bytes32 matchId, address winner, bytes[4] calldata playerSigs) external;
function timeout(bytes32 matchId) external;

event MatchStarted(bytes32 indexed matchId, address[4] players, uint256 escrow);
event MatchSettled(bytes32 indexed matchId, address indexed winner, uint256 payout, uint256 fee);
event MatchRefunded(bytes32 indexed matchId, uint256 perPlayer);
event SeatJoined(bytes32 indexed matchId, address indexed player, uint8 seat);
event SeatWithdrawn(bytes32 indexed matchId, address indexed player);
```

`join` pulls `entryFee` with `transferFrom`, so the player approves first. It
rejects a caller already seated in that match and any `matchId` not in `Empty`
or `Filling`.

## Security properties

**The operator chooses among four payers and nothing else.** `settle` requires
`winner` to be one of `match.players`. It cannot pay an outside address, change
the payout, skim above `feeBps`, or move escrow from another match. Against the
current model, where the treasury key can transfer any balance anywhere, this is
the main gain.

**Signature replay is closed.** The EIP-712 domain carries `chainId` and the
contract address, so a signature cannot cross chains or deployments. The status
check closes replay within a deployment: a settled match is terminal.

**Funds cannot be stranded by an absent operator.** `timeout()` needs no
operator involvement and any seated player can call it.

**Reentrancy.** ERC-20 `transfer` does not invoke recipient code, so a hostile
recipient cannot revert or re-enter the way a native-ETH push would. The
contract still applies checks-effects-interactions and a `nonReentrant` guard,
because a token with transfer hooks would otherwise reopen the hole.

**Owner powers are limited to routing.** The owner can rotate the operator key
and the three destination wallets. It cannot alter rates, seat count, entry fee,
the deadline, or touch escrow.

## What this design does not guarantee

**The burn is an allocation, not a burn.** The fee is USDG; the burn concerns
$BOARD. The contract proves 35% of the fee reached the burn wallet. Swapping
USDG for BOARD and burning it remains an off-chain action that the contract
cannot verify. Player-facing copy must say "allocated to buyback and burn", not
"burned". `src/lib/mock/faq.ts:151` and `:156` currently overstate this;
`src/lib/mock/token-roadmap.ts:10` already states it correctly.

**The operator still decides the winner.** This design bounds the damage, it
does not remove the trust. `settleByPlayers` is the escape hatch when all four
players agree, and it is the upgrade path toward a trustless result.

**Results are not disputable.** There is no challenge window. A wrong result
signed by the operator is final once settled.

## Server integration

The contract becomes the source of truth for seats, which retires code rather
than adding to it:

| Retired | Replaced by |
| --- | --- |
| Explorer-history sit verification, `play-chain.ts:313-343` | `SeatJoined` / `MatchStarted` events |
| `usedTx` replay set, `play-table.service.ts:101` | Contract rejects a second `join` from the same address |
| `pendingRefunds` queue and `flushPendingRefunds` | `withdraw()` and `timeout()`, called by players |
| `refundSit`, `play-chain.ts:623` | as above |
| Treasury payout signing in `play-settlement.service.ts` | `settle()` with an operator signature |

The operator submits the `settle` transaction and pays its gas, so winning stays
gasless for players. Players already spend gas on `approve` and `join`; charging
them again to collect their own winnings is a worse trade than the operator
carrying one transaction per settled match.

That keeps the treasury a transaction sender, so the nonce journal in
`play_documents` and `reconcileTreasuryTransfers` stay, now guarding `settle`
submissions rather than USDG transfers. The idempotency argument is unchanged:
the signed intent is journaled before broadcast, and a retry reuses it. Escrow
is no longer at risk if that key leaks, because the contract bounds what a
`settle` signature can do.

`play-table.service.ts:229-240` already pins the store to a network, treasury
and asset. The contract address joins that pin, so a store from one deployment
cannot be reused against another.

## Migration

1. Deploy to Robinhood testnet; run the Foundry suite against it.
2. Add the contract address to the store's network pin.
3. Stop new entries with the existing `PLAY_MAINNET_ENABLED` gate.
4. Let in-flight matches settle or time out through the custodial path.
5. Advance `entryCutoverBlock` past the last custodial entry so old payments
   cannot be replayed against the new ledger.
6. Enable entries against the contract.

Escrow is never migrated. The custodial treasury drains naturally, which avoids
moving player funds during a cutover.

## Testing

Contract tests are Foundry, a toolchain this repo does not yet have. The
existing suite runs on `node --test` via `tsx` and stays as is.

Required cases:

- a fourth `join` starts the match and escrows exactly `entryFee * seats`
- `join` rejects a duplicate address, a full match, and a settled match
- `withdraw` works while `Filling` and reverts once `Playing`
- `settle` pays 3.92 to the winner and splits 0.08 as 0.024 / 0.028 / 0.028
- `settle` reverts when `winner` is not seated
- `settle` reverts on a signature from a non-operator key
- `settle` reverts on a signature for a different `matchId`, chain, or contract
- `settle` reverts on a second call
- `timeout` reverts before the deadline and refunds all four in full after it
- `timeout` takes no fee
- the contract holds a zero balance after settle or timeout

The TypeScript side gets one integration test that drives a match against a
local chain, replacing the parts of `tests/paid-play.test.ts` that assert
explorer-scanning behaviour.

## Risks

**A new toolchain.** Solidity, Foundry and a deployment process are new to this
repo. The contract is small, but the operational surface is not.

**A rewrite of the sit flow.** Choosing contract-owned seats means the waiting
room, `use-play-sit`, and a large part of `play-table.service.ts` change.
`tests/paid-play.test.ts` is 39K and much of it asserts the behaviour being
replaced.

**The asset mismatch between repos is unresolved.** `moudybk1/demoboard` reverted
to a 0.002 ETH entry while this repo uses 1 USDG. The contract encodes USDG. If
the site is deployed against this contract without reconciling that, its sit
flow pays the wrong asset and every join reverts.
