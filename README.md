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
  refunds, and winner payouts. Never commit this value.
- `NEXT_PUBLIC_APP_URL`: this game deployment's public origin.
- `NEXT_PUBLIC_WEBSITE_URL`: the public marketing website origin.
- `NEXT_PUBLIC_CHAIN_ENV`: `testnet` while validating or `mainnet` for launch.
- `NEXT_PUBLIC_RPC_URL`: dedicated chain RPC endpoint.
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: WalletConnect project identifier.
- `PAYMENT_WEBHOOK_SECRET`: shared secret for payment/indexer endpoints.

Keep `ALLOW_MOCK_WALLET_VERIFY` unset in production.

## Verification

```bash
npm run lint
npm run test:ludo-rules
npm run test:paid-play
npm run test:wallet-security
npm run build
```

For the four-wallet testnet procedure and settlement checks, see
`docs/ludo-launch-verification.md` and `docs/paid-play.md`.
