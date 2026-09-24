import { connectWallet, E2E_CHAIN_ID, expect, test } from "./fixtures/injected-wallet";

/**
 * Covers the wallet integration the unit suites cannot reach: what the browser
 * actually renders once a chain-aware provider is connected.
 *
 * The balance assertion is the point of this file. A stale mainnet-only guard
 * left the chip showing an ellipsis forever on testnet, and every server-side
 * test still passed, because nothing exercised the rendered value.
 */

test.describe("wallet on Robinhood testnet", () => {
  test("the lobby loads and detects the injected wallet", async ({ page, walletAddress }) => {
    await page.goto("/play");

    // The connector scan happens at load, so the provider must already exist.
    const detected = await page.evaluate(
      () => (window as unknown as { ethereum?: { isBoardE2E?: boolean } }).ethereum?.isBoardE2E,
    );
    expect(detected, "injected provider should be present before app code runs").toBe(true);
    expect(walletAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  test("the app targets the configured chain, not mainnet", async ({ page }) => {
    await page.goto("/play");

    const config = await page.request.get("/api/play/config");
    expect(config.ok()).toBe(true);

    const body = await config.json();
    expect(body.chainId, "config should follow NEXT_PUBLIC_CHAIN_ENV").toBe(E2E_CHAIN_ID);
    expect(String(body.token).toLowerCase()).not.toBe(
      "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    );
  });

  test("the stake balance resolves instead of showing an endless ellipsis", async ({ page }) => {
    await page.goto("/play");

    const chip = await connectWallet(page);

    // The regression this guards: a stale mainnet-only condition disabled the
    // balance query off mainnet, leaving an ellipsis that never resolved.
    // Both branches of the chip's ternary render the same ellipsis, so a
    // disabled query was indistinguishable from a slow one.
    await expect
      .poll(async () => (await chip.textContent()) ?? "", {
        message: "balance should resolve to a figure, not stay an ellipsis",
        timeout: 20_000,
      })
      .toMatch(/\d[\d,.]*\s*USDG/i);
  });
});
