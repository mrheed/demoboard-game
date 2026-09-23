import { http, createConfig, createStorage, cookieStorage, type CreateConnectorFn } from "wagmi";
import { injected, metaMask, walletConnect } from "wagmi/connectors";
import { robinhood, robinhoodTestnet } from "viem/chains";

import {
  getBoardChain,
  getBoardChainEnv,
  getBoardRpcUrl,
} from "@/lib/wallet/chains";
import { BOARD_WAGMI_STORAGE_KEY } from "@/lib/wallet/wagmi-storage";

const OKX_RDNS = "com.okex.wallet";

function walletConnectProjectId() {
  return (
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
    "c4f79cc821685d19ea6ea6c793ffcebd"
  );
}

/**
 * WalletConnect rejects metadata that doesn't match the page the friend is on.
 * In the browser, use that page. On the server, fall back to the configured URL.
 */
function boardAppUrl() {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return configured || "http://localhost:3000";
}

type OkxProvider = {
  request?: (args: { method: string; params?: unknown }) => Promise<unknown>;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  providers?: OkxProvider[];
  ethereum?: OkxProvider;
};

/** OKX extension and in-app browser. The provider is `okxwallet`, not always `ethereum`. */
function findOkxProvider(win: unknown): OkxProvider | undefined {
  if (!win || typeof win !== "object") return undefined;
  const host = win as { okxwallet?: OkxProvider; ethereum?: OkxProvider };

  const okx = host.okxwallet;
  if (typeof okx?.request === "function") return okx;
  if (typeof okx?.ethereum?.request === "function") return okx.ethereum;

  const ethereum = host.ethereum;
  if (ethereum?.isOkxWallet || ethereum?.isOKExWallet) return ethereum;
  const nested = ethereum?.providers?.find(
    (provider) => provider.isOkxWallet || provider.isOKExWallet,
  );
  if (nested) return nested;

  if (typeof window === "undefined" || win !== window) return undefined;

  let announced: OkxProvider | undefined;
  const onAnnounce = (event: Event) => {
    const detail = (
      event as CustomEvent<{ info?: { rdns?: string }; provider?: OkxProvider }>
    ).detail;
    if (
      detail?.info?.rdns === OKX_RDNS &&
      typeof detail.provider?.request === "function"
    ) {
      announced = detail.provider;
    }
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);
  return announced;
}

function isAndroid() {
  return (
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
  );
}

function okxDownloadUrls() {
  return {
    android: "https://play.google.com/store/apps/details?id=com.okinc.okex.gp",
    ios: "https://itunes.apple.com/app/id1327268470?mt=8",
    mobile: "https://okx.com/download",
    qrCode: "https://okx.com/download",
    chrome:
      "https://chrome.google.com/webstore/detail/okx-wallet/mcohilncbfahbmgdjkbpemcciiolgcge",
    edge: "https://microsoftedge.microsoft.com/addons/detail/okx-wallet/pbpjkcldjiffchgbbndmhojiacbgflha",
    firefox: "https://addons.mozilla.org/firefox/addon/okexwallet/",
    browserExtension: "https://okx.com/download",
  };
}

/**
 * RainbowKit only lists connectors that carry `rkDetails`. A raw wagmi
 * connector is hidden, so the installed OKX extension was connected through
 * EIP-6963, which calls `wallet_requestPermissions`. OKX hangs or rejects
 * that method, and Connect never finishes.
 *
 * `rdns` makes Wagmi skip that duplicate. The extension then uses
 * `eth_requestAccounts` directly. Phones, which have no extension, use
 * WalletConnect and the OKX deep link.
 */
function okxConnector(
  appUrl: string,
  projectId: string,
  hasExtension: boolean,
): CreateConnectorFn {
  const iconUrl = `${appUrl}/wallets/okx.svg`;

  const base = {
    id: "okx" as const,
    name: "OKX Wallet",
    rdns: OKX_RDNS,
    iconUrl,
    iconBackground: "#000",
    groupName: "Popular" as const,
    groupIndex: 1,
    isRainbowKitConnector: true as const,
    downloadUrls: okxDownloadUrls(),
  };

  if (!hasExtension) {
    const connect = walletConnect({
      projectId,
      showQrModal: false,
      metadata: {
        name: "BOARD",
        description: "Play classic board games, win real tokens",
        url: appUrl,
        icons: [`${appUrl}/board-logo.png`],
      },
      customStoragePrefix: "okx",
    } as Parameters<typeof walletConnect>[0]);

    return (config) => ({
      ...connect(config),
      id: "okx",
      name: "OKX Wallet",
      rdns: OKX_RDNS,
      rkDetails: {
        ...base,
        mobile: {
          getUri: (uri: string) =>
            isAndroid() ? uri : `okex://main/wc?uri=${encodeURIComponent(uri)}`,
        },
        qrCode: {
          getUri: (uri: string) => uri,
        },
      },
    });
  }

  const connect = injected({
    shimDisconnect: false,
    target() {
      return {
        id: "okx",
        name: "OKX Wallet",
        provider(win) {
          return findOkxProvider(win) as never;
        },
      };
    },
  });

  return (config) => ({
    ...connect(config),
    rdns: OKX_RDNS,
    rkDetails: {
      ...base,
      installed: true,
    },
  });
}

function buildConnectors() {
  const appUrl = boardAppUrl();
  const projectId = walletConnectProjectId();
  const hasOkxExtension = Boolean(
    findOkxProvider(typeof window === "undefined" ? undefined : window),
  );

  return [
    metaMask({
      dappMetadata: {
        name: "BOARD",
        url: appUrl,
        iconUrl: `${appUrl}/board-logo.png`,
      },
    }),
    okxConnector(appUrl, projectId, hasOkxExtension),
    injected({
      shimDisconnect: true,
      target: {
        id: "rabby",
        name: "Rabby",
        provider: ((win: unknown) => {
          const eth = (win as { ethereum?: OkxProvider & { isRabby?: boolean } })
            ?.ethereum;
          if (!eth) return undefined;
          if (eth.isRabby) return eth;
          return eth.providers?.find((provider) =>
            Boolean((provider as { isRabby?: boolean }).isRabby),
          );
        }) as never,
      },
    }),
    injected({
      shimDisconnect: true,
      target: {
        id: "browser",
        name: "Browser Wallet",
        provider: ((win: unknown) =>
          (win as { ethereum?: unknown })?.ethereum) as never,
      },
    }),
    // One WalletConnect core only. OKX already uses it when the extension
    // is absent; a second init makes WalletConnect refuse the session.
    ...(hasOkxExtension
      ? [
          walletConnect({
            projectId,
            metadata: {
              name: "BOARD",
              description: "Play classic board games, win real tokens",
              url: appUrl,
              icons: [`${appUrl}/board-logo.png`],
            },
            showQrModal: false,
          }),
        ]
      : []),
  ];
}

const chain = getBoardChain();
const rpcUrl = getBoardRpcUrl();
const env = getBoardChainEnv();

/**
 * Shared wagmi config (safe for server cookie hydration + RainbowKit).
 * Only the active board chain is listed so RainbowKit cannot offer the other
 * Robinhood network (testnet vs mainnet) as a switch target.
 */
export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: buildConnectors(),
  transports: {
    // Both keys satisfy wagmi's union typing; only `chain` is selectable.
    [robinhoodTestnet.id]: http(
      env === "testnet" ? rpcUrl : "https://rpc.testnet.chain.robinhood.com",
    ),
    [robinhood.id]: http(
      env === "mainnet" ? rpcUrl : "https://rpc.mainnet.chain.robinhood.com",
    ),
  },
  ssr: true,
  storage: createStorage({
    key: BOARD_WAGMI_STORAGE_KEY,
    storage: cookieStorage,
  }),
});
