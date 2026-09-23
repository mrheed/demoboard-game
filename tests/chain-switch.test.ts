import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

/**
 * The network switcher in the play lobby already follows NEXT_PUBLIC_CHAIN_ENV.
 * These cover the two things that did not: which token the app treats as the
 * stake, and whether paid entry is allowed off mainnet.
 *
 * Each case re-imports the module under a fresh registry because the chain env
 * is read at call time but the module cache is not.
 */
async function withChainEnv<T>(
  env: "mainnet" | "testnet",
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.NEXT_PUBLIC_CHAIN_ENV;
  process.env.NEXT_PUBLIC_CHAIN_ENV = env;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_CHAIN_ENV;
    else process.env.NEXT_PUBLIC_CHAIN_ENV = previous;
  }
}

test("the stake token follows the selected chain", async () => {
  const { getUsdgAddress, ROBINHOOD_USDG_ADDRESS, ROBINHOOD_TESTNET_USDG_ADDRESS } =
    await import("../src/lib/wallet/usdg");

  await withChainEnv("mainnet", async () => {
    assert.equal(getUsdgAddress(), ROBINHOOD_USDG_ADDRESS);
  });

  await withChainEnv("testnet", async () => {
    assert.equal(getUsdgAddress(), ROBINHOOD_TESTNET_USDG_ADDRESS);
  });
});

test("an explicit NEXT_PUBLIC_USDG_ADDRESS overrides the testnet default", async () => {
  const { getUsdgAddress } = await import("../src/lib/wallet/usdg");
  const override = "0x00000000000000000000000000000000000000Ff";
  const previous = process.env.NEXT_PUBLIC_USDG_ADDRESS;
  process.env.NEXT_PUBLIC_USDG_ADDRESS = override;
  try {
    await withChainEnv("testnet", async () => {
      assert.equal(getUsdgAddress().toLowerCase(), override.toLowerCase());
    });
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_USDG_ADDRESS;
    else process.env.NEXT_PUBLIC_USDG_ADDRESS = previous;
  }
});

test("mainnet still needs the release flag; testnet does not", async () => {
  const { getPlayEntryReadiness } = await import("../src/server/lib/play-readiness");
  const previousFlag = process.env.PLAY_MAINNET_ENABLED;
  // The npm script runs with NODE_ENV=test, which short-circuits the worker
  // heartbeat. The mainnet flag check runs before that short-circuit, so both
  // assertions below still exercise the real branch.
  delete process.env.PLAY_MAINNET_ENABLED;

  try {
    await withChainEnv("mainnet", async () => {
      const readiness = await getPlayEntryReadiness();
      assert.equal(readiness.entriesAllowed, false);
      assert.match(String(readiness.entryBlockReason), /release approval/i);
    });

    await withChainEnv("testnet", async () => {
      const readiness = await getPlayEntryReadiness();
      assert.equal(readiness.entriesAllowed, true, "testnet entries should open");
      assert.equal(readiness.entryBlockReason, null);
    });
  } finally {
    if (previousFlag === undefined) delete process.env.PLAY_MAINNET_ENABLED;
    else process.env.PLAY_MAINNET_ENABLED = previousFlag;
  }
});

test("PLAY_DATA_DIR gives each chain its own local ledger", async () => {
  const { playDataDir } = await import("../src/server/lib/play-data-path");
  const previous = process.env.PLAY_DATA_DIR;

  try {
    delete process.env.PLAY_DATA_DIR;
    assert.equal(playDataDir(), join(process.cwd(), ".data"));

    // The store pins itself to one chain and refuses to be reused on another,
    // so switching locally needs a separate directory rather than a flag.
    process.env.PLAY_DATA_DIR = "/tmp/board-testnet";
    assert.equal(playDataDir(), "/tmp/board-testnet");
  } finally {
    if (previous === undefined) delete process.env.PLAY_DATA_DIR;
    else process.env.PLAY_DATA_DIR = previous;
  }
});

test("no module hardcodes the mainnet token for runtime resolution", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");

  // usdg.ts defines the constants; everything else must go through
  // getUsdgAddress() or a testnet build silently talks to the mainnet token.
  const allowed = join("src", "lib", "wallet", "usdg.ts");
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(path) || path === allowed) continue;
      if (readFileSync(path, "utf8").includes("ROBINHOOD_USDG_ADDRESS")) {
        offenders.push(path);
      }
    }
  };
  walk("src");

  assert.deepEqual(offenders, [], `use getUsdgAddress() in: ${offenders.join(", ")}`);
});
