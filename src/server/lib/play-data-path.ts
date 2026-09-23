import { join } from "node:path";

/**
 * Writable folder for play treasury / table snapshots.
 * Local: `.data` under the repo. Vercel: `/tmp` (ephemeral per instance).
 *
 * `PLAY_DATA_DIR` overrides it. The ledger pins itself to one chain, treasury
 * and stake token, and refuses to be reused on another, so switching networks
 * locally needs its own directory rather than only a different
 * `NEXT_PUBLIC_CHAIN_ENV`.
 */
export function playDataDir() {
  const override = process.env.PLAY_DATA_DIR?.trim();
  if (override) return override;

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return join("/tmp", "board-play-data");
  }
  return join(process.cwd(), ".data");
}

export function playDataPath(filename: string) {
  return join(playDataDir(), filename);
}
