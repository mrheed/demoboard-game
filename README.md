# BOARD Game Client

The separately deployable BOARD game application. It contains the current
paid four-player Ludo client, wallet authentication, server-authoritative game
actions, settlement services, database schema, and payment worker.

The public marketing website lives in the `moudybk1/demoboard` repository.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

The game runs at [http://localhost:3001](http://localhost:3001) and redirects
the root route to `/play`. The website runs separately on port 3000.

## Required production configuration

- `DATABASE_URL`: production Postgres database.
- `PLAY_TREASURY_PRIVATE_KEY`: funded operator treasury key used for entries,
  refunds, and winner payouts. Fund it with canonical USDG and native ETH for
  gas. Never commit this value.
- `NEXT_PUBLIC_APP_URL`: this game deployment's public origin.
- `NEXT_PUBLIC_WEBSITE_URL`: the public marketing website origin.
- `NEXT_PUBLIC_CHAIN_ENV`: must be `mainnet` for USDG paid play.
- `NEXT_PUBLIC_RPC_URL`: dedicated chain RPC endpoint.
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: WalletConnect project identifier.
- `PAYMENT_WEBHOOK_SECRET`: shared secret for payment/indexer endpoints.
- `PLAY_MAINNET_ENABLED=true`: final release gate; leave unset until the ledger,
  worker, treasury, and operational launch checks are approved.
- `PLAY_PAYMENT_CONFIRMATIONS`: reviewed confirmation depth; defaults to 30.

Keep `ALLOW_MOCK_WALLET_VERIFY` unset in production.

## Verification

```bash
npm run play:doctor
npm run lint
npm run test:ludo-rules
npm run test:paid-play
npm run test:wallet-security
npm run build
```

`play:doctor` is read-only: it prints launch blockers without exposing the
treasury key or broadcasting transactions. It intentionally exits non-zero
until the production database/ledger, dedicated RPC, treasury reserves,
worker heartbeat, wallet/service configuration, and final release gate pass.

For the four-wallet staging procedure and mainnet settlement checks, see
`docs/ludo-launch-verification.md` and `docs/paid-play.md`.
