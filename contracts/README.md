# BoardTreasury

Per-match escrow for paid BOARD tables. Design and rationale live in
[`../docs/treasury-contract-design.md`](../docs/treasury-contract-design.md).

Players fund their own seat, so the contract counts a table from its own storage
and needs no oracle to know a match started. It cannot know who won, so a result
is attested. What an attester may assert is narrow: `settle` accepts only a
winner already seated in that match, and every amount comes from immutable
rates.

## Setup

Dependencies are not committed. `foundry.lock` pins the versions.

```bash
cd contracts
forge install      # restores forge-std and openzeppelin-contracts
forge build
forge test
```

## Layout

| Path | Contents |
| --- | --- |
| `src/BoardTreasury.sol` | the contract |
| `test/BoardTreasury.t.sol` | 25 tests, including a split-conservation fuzz test |
| `test/mocks/MockUSDG.sol` | six-decimal ERC-20 stand-in for USDG |

## Deployment parameters

Rates are immutable. A compromised operator or owner key cannot change the
economics; the owner can only rotate the operator and the three fee wallets.

| Parameter | Mainnet value | Source |
| --- | --- | --- |
| `stake` | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | `src/lib/wallet/usdg.ts` |
| `entryFee` | `1000000` (1 USDG) | `PLAY_ENTRY_FEE_USDG` |
| `seats` | `4` | `MAX_PLAYERS_PER_ROOM` |
| `feeBps` | `200` (2%) | `PRIZE_FEE_RATE` |
| `devBps` | `3000` | `economy.service.ts` |
| `buybackBps` | `3500` | `economy.service.ts` |
| `settleDeadline` | `7200` (2 hours) | design doc |

`burnBps` is not a parameter. It is the remainder after development and
buyback, so rounding dust cannot be stranded in the contract.

For a full table: escrow 4.00 USDG, fee 0.08, winner 3.92, split 0.024 /
0.028 / 0.028.

## Settling

`settle(matchId, winner, operatorSig)` takes an EIP-712 signature over:

```
Result(bytes32 matchId,address winner)
```

The domain is `BoardTreasury` version `1`, bound to the chain id and the
contract address, so a signature cannot be replayed across chains or
deployments. `domainSeparator()` is exposed for building the digest off-chain.

`settleByPlayers(matchId, winner, playerSigs)` is the alternative: when every
seated player signs the same result, no operator is involved at all.

## What this does not do

The fee is USDG. The burn concerns $BOARD. The contract proves 35% of the fee
reached the burn wallet and nothing more; swapping and burning stays an
off-chain action. Player-facing copy should say "allocated to buyback and
burn", not "burned".

There is no challenge window. A signed result is final once settled.
