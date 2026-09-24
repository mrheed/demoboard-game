import { test as base, type Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

/**
 * A browser wallet, without a browser extension.
 *
 * wagmi's `injected({ id: "browser" })` connector only needs `window.ethereum`
 * to answer a handful of EIP-1193 calls. Installing a small provider before
 * app code runs exercises the integration this project owns (connect, chain
 * switch, SIWE signature, token reads) without the cost and flakiness of
 * driving MetaMask itself.
 *
 * Signing happens in Node, where the key lives, so the key never reaches the
 * page. The page asks, the fixture signs, the page gets a signature back.
 */

/** Throwaway key. Testnet only; it holds nothing of value. */
export const E2E_PRIVATE_KEY: Hex =
  (process.env.E2E_PRIVATE_KEY as Hex | undefined) ??
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

export const E2E_CHAIN_ID = Number(process.env.E2E_CHAIN_ID ?? 46630);
export const E2E_RPC_URL =
  process.env.E2E_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";

const account = privateKeyToAccount(E2E_PRIVATE_KEY);

/** Requests the page may not make; everything else is forwarded to the RPC. */
type PendingSignature = { method: string; params: unknown[] };

/**
 * Installs the provider and bridges signing back into Node.
 *
 * `addInitScript` runs before any page script, so wagmi sees `window.ethereum`
 * during its initial connector scan rather than after.
 */
export async function installWallet(page: Page) {
  await page.exposeFunction(
    "__e2eSign",
    async ({ method, params }: PendingSignature) => {
      if (method === "personal_sign") {
        const [data] = params as [Hex, string];
        return account.signMessage({ message: { raw: data } });
      }
      if (method === "eth_signTypedData_v4") {
        const [, json] = params as [string, string];
        return account.signTypedData(JSON.parse(json));
      }
      throw new Error(`Unsupported signing method: ${method}`);
    },
  );

  await page.addInitScript(
    ({ address, chainId, rpcUrl }) => {
      const hexChainId = `0x${chainId.toString(16)}`;
      const listeners = new Map<string, Set<(payload: unknown) => void>>();

      const emit = (event: string, payload: unknown) => {
        for (const listener of listeners.get(event) ?? []) listener(payload);
      };

      const rpc = async (method: string, params: unknown[]) => {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
        });
        const body = await response.json();
        if (body.error) throw new Error(body.error.message ?? "RPC error");
        return body.result;
      };

      const provider = {
        isMetaMask: false,
        isBoardE2E: true,

        async request({ method, params = [] }: { method: string; params?: unknown[] }) {
          switch (method) {
            case "eth_requestAccounts":
            case "eth_accounts":
              return [address];
            case "eth_chainId":
              return hexChainId;
            case "net_version":
              return String(chainId);
            case "wallet_switchEthereumChain":
              // Only one chain is configured, so a switch is already satisfied.
              emit("chainChanged", hexChainId);
              return null;
            case "wallet_addEthereumChain":
            case "wallet_requestPermissions":
              return null;
            case "personal_sign":
            case "eth_signTypedData_v4":
              return (
                window as unknown as {
                  __e2eSign: (r: { method: string; params: unknown[] }) => Promise<string>;
                }
              ).__e2eSign({ method, params });
            default:
              return rpc(method, params);
          }
        },

        on(event: string, listener: (payload: unknown) => void) {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(listener);
          return provider;
        },
        removeListener(event: string, listener: (payload: unknown) => void) {
          listeners.get(event)?.delete(listener);
          return provider;
        },
      };

      Object.defineProperty(window, "ethereum", {
        value: provider,
        writable: false,
        configurable: true,
      });

      // The app's OKX connector resolves its provider from `window.okxwallet`
      // (see wagmi-config.ts). RainbowKit renders a fixed wallet list and
      // ignores EIP-6963 announcements here, so binding the fixture to that
      // target is what lets the test drive the app's real connector rather
      // than a synthetic one.
      Object.defineProperty(window, "okxwallet", {
        value: provider,
        writable: false,
        configurable: true,
      });

      // Legacy signal, for connectors that wait rather than poll.
      window.dispatchEvent(new Event("ethereum#initialized"));

      // EIP-6963 is how wagmi v2 and RainbowKit actually discover wallets.
      // Without it a bare window.ethereum is not offered in the modal, which
      // is why the generic "Browser Wallet" entry never appeared.
      const detail = Object.freeze({
        info: {
          uuid: "11111111-2222-3333-4444-555555555555",
          name: "E2E Wallet",
          rdns: "dev.board.e2e",
          icon:
            "data:image/svg+xml;base64," +
            btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'),
        },
        provider,
      });

      const announce = () =>
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));

      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { address: account.address, chainId: E2E_CHAIN_ID, rpcUrl: E2E_RPC_URL },
  );
}


/**
 * Get to a connected wallet, however the app chooses to get there.
 *
 * wagmi reconnects to the injected provider on load, so the RainbowKit modal
 * often closes on its own mid-click. Asserting on the connected chip rather
 * than on the modal keeps the test about the outcome instead of racing a
 * third-party animation.
 */
export async function connectWallet(page: Page) {
  const chip = page.getByRole("button", { name: /wallet 0x/i }).first();
  if (await chip.isVisible().catch(() => false)) return chip;

  const connect = page.getByRole("button", { name: /^connect wallet$/i }).first();
  if (await connect.isVisible().catch(() => false)) {
    await connect.click().catch(() => undefined);
  }

  // Best effort: if the app connects itself, this option vanishes first.
  await page
    .locator('[data-testid="rk-wallet-option-okx"]')
    .click({ timeout: 5_000 })
    .catch(() => undefined);

  await chip.waitFor({ state: "visible", timeout: 30_000 });
  return chip;
}

export const test = base.extend<{ wallet: void; walletAddress: string }>({
  // Auto, because Playwright fixtures are lazy: a test that does not name the
  // fixture would otherwise run with no provider installed at all, and fail
  // for a reason that looks nothing like the real cause.
  wallet: [
    async ({ page }, use) => {
      await installWallet(page);
      await use();
    },
    { auto: true },
  ],
  walletAddress: async ({ wallet }, use) => {
    void wallet;
    await use(account.address);
  },
});

export { expect } from "@playwright/test";
