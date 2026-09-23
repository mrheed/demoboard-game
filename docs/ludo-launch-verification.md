# Ludo launch verification — 23 September 2026

## Outcome: blocked for mainnet

The identified paths have implementation fixes and focused regression coverage. This is **not** a zero-bug guarantee, deployed-contract audit, or mainnet approval. No real wallet transactions, production migrations, deployments, or account recovery actions were performed. Existing user changes were preserved.

The security fix-finding workflow included a separate boundary investigation and one fresh candidate review. Confirmed review issues were reproduced, patched, and retested: old playing tables without authoritative state, ready/resume receipt adoption, missing PostgreSQL financial state, and cross-ledger historical payment replay.

## Security boundaries and compatibility

- **Wallet ownership:** an attacker could reserve another address through wallet linking and influence account selection or a primary destination before reliable proof. Account selection, linking, and play authorization now require verified ownership provenance, account-bound expiring proofs, and shared wallet locks. Invalid signatures cannot consume login challenges; verified secondary-wallet login remains supported and does not change the primary wallet.
- **Legacy identity:** migration `0013_wild_ares.sql` quarantines pre-existing wallet accounts and revokes their old sessions. It preserves wallets, balances, ledgers, and matches. This is the safer choice authorized by the user because old links cannot be reliably classified. It was exercised only on disposable fixtures, not applied to the real database. Ownership review is required before releasing any hold; bulk clearing holds is unsafe.
- **Game authority:** paid browser boards and local dice cannot select authoritative moves or outcomes. Actions use persisted server state, authenticated wallet ownership, match IDs, versions, and legal-move checks. Concurrent stale actions are rejected. A standalone worker advances missed deadlines even without browsers.
- **Payment authority:** four funded human seats are required; no house bots enter paid Ludo. Winner amounts come from the authoritative match, not client calculations. Signed treasury intents and nonces are saved before broadcast, reused on retry, and validated against their immutable payment details. A successful receipt is required for a confirmed payout/refund.
- **Recovery:** ready/resume cannot create a seat from a supplied receipt or token. Authenticated recovery returns an existing seat only. Imported playing tables lacking server state queue one full refund per funded human instead of forfeiting their money. A missing PostgreSQL ledger fails closed; explicit import preserves consumed hashes and enforces a chain-block cutover against old payment replay. Ambiguous historical refunds are held for review.

These shared service/storage boundaries cover the existing callers without trusting another browser-side representation. Legitimate funded seats, verified multi-wallet accounts, authoritative saved matches, and confirmed payment records remain recoverable. Old BOARD-ledger entry is retired; historical BOARD match recovery needs an operator-reviewed plan rather than silently treating it as USDG.

## Gameplay and user experience

Monopoly is disabled for new games and marked “Work in progress.” Existing paid liabilities are preserved. Ludo uses a published, versioned BOARD ruleset; variants of Ludo differ, so this is not presented as the only universal ruleset.

New games use 52 shared squares, four pawns, six-to-enter, exact home entry, safe squares, opponent blockades, capture/finish bonuses, and a third-six penalty. Old authoritative snapshots retain their prior geometry. Each roll/move decision has a 15-second server deadline; three cumulative misses eliminate a player. Missing a move discards its roll, rather than silently moving a pawn for the player. Twenty seeded complete games supplement targeted rule tests.

Unready entries expire after two minutes; incomplete waiting rooms expire after five minutes from first entry. Full refunds are persisted and visible in `/play/history`. Result screens distinguish pending, submitted, failed, and confirmed payment states. Public rules, FAQ, how-to, homepage economics, and token-contract copy describe the canonical USDG mainnet flow. History text contrast was corrected during browser verification.

## Actual money flow

| Stage | Destination / amount |
| --- | --- |
| Entry | Each player transfers exactly 1 USDG to the operator treasury and pays ETH network gas |
| Four funded players | Total pot: 4 USDG |
| Winner | 3.92 USDG (98%) sent from that treasury |
| Fee | 0.08 USDG (2%) remains in that treasury |
| Pre-start exit / expiry | Full 1 USDG refund; operator pays ETH refund gas separately |

There is no game escrow smart contract in this repository's paid flow, and no automatic fee-split transfer, buyback, or burn. The BOARD ERC-20 contract is not the canonical USDG payment contract. Server dice are cryptographically random but not independently verifiable on-chain randomness. Treasury solvency, key custody, chain finality, and operator reliability are real trust assumptions.

## Ordered verification gates

1. **Syntax, types, imports, build**
   - `npx tsc --noEmit`: passed.
   - Repository-wide `npm run lint`: passed.
   - `git diff --check`: passed.
   - `npm run build`: passed, including TypeScript and 51 static pages.
2. **Security triggers and alternate inputs**
   - `BOARD_TEST_PG_PORT=55439 npm run test:paid-play`: 27 passed.
   - `BOARD_TEST_PG_PORT=55439 npm run test:wallet-security`: 11 passed.
   - `npm run test:paid-play` using isolated file storage: 27 passed.
   - Reproductions reject forged-wallet/anonymous actions, unverified wallet takeover, expired/replayed proofs, wrong-network aliases, stale actions, receipt/token adoption, wrong USDG amount, same-symbol impostor contracts, missing transfer events, insufficient confirmation depth, and pre-cutover historical payments. Reverted transfers do not become confirmed. Concurrent retry uses one signed transfer, not a second payout.
3. **Legitimate controls and surrounding checks**
   - `npm run test:ludo-rules`: 8 passed, including twenty complete seeded games.
   - `npm run test:auth-mock`: 1 passed.
   - `NODE_ENV=test npx tsx src/lib/game/game-rules.check.ts`: passed.
   - Controls cover legitimate secondary-wallet linking/login, unchanged primary selection, independent readers seeing one board, exact payouts, waiting-room refunds, saved match recovery, and preserved migration balances. Concurrent document locks and treasury nonce reservations were exercised against disposable PostgreSQL.
   - Isolated `npm run play:worker`: starts and records gameplay/payment health. With deliberately unavailable loopback RPC it records a payment error; `/api/play/config` returns `entriesAllowed:false` and `canRefund:false`. The fixture worker was then stopped.
   - Browser: the mainnet `/play` wallet gate and public `/rules` page render without a framework overlay or page exception. The rules page displays Robinhood Chain mainnet, 1 USDG entry, and the 3.92 USDG winner amount. Browser console output contained only development/HMR notices. This does not verify a connected-wallet lobby or completed live match.
   - Live local `/api/play/config`: chain ID 4663, canonical USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 1,000,000 atomic entry amount, and 30 required confirmations. It correctly returns `entriesAllowed:false` while the explicit mainnet release gate is disabled.

All chain-payment regression suites use fake RPC responses and disposable keys; no real funds were sent. The original focused reproductions no longer succeed, while the controls above pass. This is evidence for these fixes, not proof that every possible gameplay or payment defect is absent.

## Principal changed files

- Identity: `src/server/lib/wallet-identity.ts`, `require-play-wallet.ts`, `src/server/services/{wallet-auth,wallet-link,auth}.service.ts`, auth routes, user/wallet/session schemas, and migration `drizzle/0013_wild_ares.sql`.
- Authority and money: `src/server/services/play-match-engine.ts`, `play-table.service.ts`, `play-settlement.service.ts`, `src/server/lib/{play-chain,play-store,play-readiness,paid-game-route}.ts`, paid/game routes, and migration `drizzle/0012_play_documents.sql`.
- Rules and UI: `src/lib/game/{ludo-geometry,ludo-rules,ludo-launch-rules}.ts`, `src/lib/game-availability.ts`, room/play components, live/session/recovery hooks, `/play/history`, rules/help pages, `src/lib/mock/token-roadmap.ts`, and `src/components/welcome/token-ca-promo.tsx`.
- Operations/tests: `scripts/{play-worker,import-play-store}.ts`, `tests/{paid-play,ludo-rules,wallet-security.db}.test.ts`, package scripts, and `docs/paid-play.md`.

## Remaining launch gates

Keep `PLAY_MAINNET_ENABLED` unset. Before enabling it:

1. Back up, reconcile, and explicitly migrate the intended financial ledger; review legacy account ownership and historical BOARD matches. The full importer CLI with real historical files/RPC was not end-to-end executed here.
2. Run four independent wallets through a controlled low-value mainnet staging window: paid entry, reconnect, concurrent turns, normal finish, forfeit, waiting expiry/refund, and successful payout receipts. Validate the intended wallet connector and mobile environment.
3. Test worker/server restarts, RPC outages, dropped/replaced transactions, and treasury gas exhaustion in the intended deployment. Reconcile all treasury liabilities and reserves. Automatic fee replacement is not implemented; failed or consumed nonces require operator recovery without deleting the journal.
4. Choose and validate the required confirmation/finality and reorganization policy. One successful receipt is not proof against a later reorg.
5. Commission an independent security assessment and approve the currently draft operating/legal terms.

Local preview runs without funded mainnet transactions. The real environment and runtime financial files were not read or changed.
