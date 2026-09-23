import type { Metadata } from "next";

import { LegalDocument, type LegalSection } from "@/components/layout/legal-document";
import { ProductShell } from "@/components/layout/product-shell";

export const metadata: Metadata = {
  title: "Terms | BOARD",
  description:
    "Draft terms of service for BOARD. Not yet written or in force.",
};

const SECTIONS: LegalSection[] = [
  {
    heading: "Who may play",
    covers:
      "Minimum age, the jurisdictions where staking tokens on a game of chance is lawful, and the countries that must be blocked. This decides where BOARD can operate at all.",
  },
  {
    heading: "What a stake is",
    covers:
      "Whether an entry fee is a wager, a fee for entry, or something else, and what that classification means for gambling licensing in each market served.",
  },
  {
    heading: "Prize pool and fees",
    covers:
      "Four 1 USDG entries on Robinhood Chain mainnet, the 2% retained treasury fee (no automatic burn), confirmed payouts, and when a winner becomes entitled to payment. See /rules for implemented mechanics; these draft terms are not legal launch approval.",
  },
  {
    heading: "Deposits and withdrawals",
    covers:
      "Operator custody of USDG entries, payout and refund delays, failed on-chain sends, legacy account ownership review, and how preserved balances may be recovered.",
  },
  {
    heading: "Abandoned and disputed matches",
    covers:
      "What happens to the pot when players leave mid match, when a match cannot be settled, and how a disputed result is resolved.",
  },
  {
    heading: "Account suspension",
    covers:
      "The conduct that ends an account, what happens to a balance when it does, and the route to appeal.",
  },
  {
    heading: "Liability and chain risk",
    covers:
      "Limits of liability, and the risks the operator does not cover: chain reorganisations, RPC outages, wallet compromise, and token price movement.",
  },
];

export default function TermsPage() {
  return (
    <ProductShell accent="gold">
      <LegalDocument
        title="Terms of service"
        intent="These terms will govern playing BOARD, staking tokens on a table, and withdrawing a balance."
        sections={SECTIONS}
      />
    </ProductShell>
  );
}
