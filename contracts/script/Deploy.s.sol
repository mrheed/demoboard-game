// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {BoardTreasury} from "../src/BoardTreasury.sol";
import {MockUSDG} from "../test/mocks/MockUSDG.sol";

/**
 * @notice Deploys BoardTreasury, plus a stand-in token on non-mainnet chains.
 *
 * Robinhood Chain mainnet (4663) carries the canonical USDG, so the script
 * uses it there and refuses to deploy a mintable token. Every other chain has
 * no USDG at all, so it deploys MockUSDG and funds the deployer.
 *
 *   PRIVATE_KEY=0x... forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast
 */
contract Deploy is Script {
    uint256 internal constant MAINNET_CHAIN_ID = 4663;
    address internal constant CANONICAL_USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    uint256 internal constant ENTRY_FEE = 1_000000; // 1 USDG, six decimals
    uint8 internal constant SEATS = 4;
    uint16 internal constant FEE_BPS = 200; // 2%
    uint16 internal constant DEV_BPS = 3000; // of the fee
    uint16 internal constant BUYBACK_BPS = 3500; // of the fee
    uint64 internal constant SETTLE_DEADLINE = 2 hours;

    /// Minted to the deployer on test chains so a table can be funded at once.
    uint256 internal constant TEST_MINT = 1_000_000000; // 1,000 USDG

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Roles default to the deployer on test chains. Mainnet must be explicit.
        address operator = vm.envOr("OPERATOR", deployer);
        address devWallet = vm.envOr("DEV_WALLET", deployer);
        address buybackWallet = vm.envOr("BUYBACK_WALLET", deployer);
        address burnWallet = vm.envOr("BURN_WALLET", deployer);
        address owner = vm.envOr("OWNER", deployer);

        bool isMainnet = block.chainid == MAINNET_CHAIN_ID;
        if (isMainnet) {
            require(operator != deployer, "set OPERATOR explicitly on mainnet");
            require(owner != deployer, "set OWNER explicitly on mainnet");
        }

        vm.startBroadcast(deployerKey);

        address stake;
        if (isMainnet) {
            stake = CANONICAL_USDG;
        } else {
            // No USDG exists off mainnet, so the table needs a stand-in.
            MockUSDG token = new MockUSDG();
            token.mint(deployer, TEST_MINT);
            stake = address(token);
        }

        BoardTreasury treasury = new BoardTreasury(
            stake,
            ENTRY_FEE,
            SEATS,
            FEE_BPS,
            DEV_BPS,
            BUYBACK_BPS,
            SETTLE_DEADLINE,
            operator,
            devWallet,
            buybackWallet,
            burnWallet,
            owner
        );

        vm.stopBroadcast();

        console.log("chain id       ", block.chainid);
        console.log("deployer       ", deployer);
        console.log("stake token    ", stake);
        console.log("BoardTreasury  ", address(treasury));
        console.log("operator       ", operator);
        console.log("owner          ", owner);
    }
}
