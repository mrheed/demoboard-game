import { LUDO_LAUNCH_RULES } from "@/lib/game/ludo-launch-rules";
import {
  HOW_TO_CTAS,
} from "@/lib/mock/how-to";
import { PRIZE_CTAS } from "@/lib/mock/prize-rules";
import { ROADMAP, TOKEN_INFO } from "@/lib/mock/token-roadmap";
import {
  ONBOARDING_ACTIONS,
  ONBOARDING_STEPS,
  WELCOME_HERO,
  WELCOME_HIGHLIGHTS,
  WELCOME_LIVE_PULSE,
} from "@/lib/mock/welcome";
import { WIN_GOAL_INTRO, WIN_GOALS } from "@/lib/mock/win-goals";

/**
 * Guide / welcome content served to the panduan surfaces. Content is curated
 * mock copy for now · swapping the source to CMS/DB later keeps the same shape.
 */

export const GUIDE_SECTIONS = [
  "welcome",
  "how-to",
  "win-goals",
  "rules",
  "token",
] as const;

export type GuideSection = (typeof GUIDE_SECTIONS)[number];

export function isGuideSection(value: string): value is GuideSection {
  return (GUIDE_SECTIONS as readonly string[]).includes(value);
}

export function getWelcomeGuide() {
  return {
    hero: WELCOME_HERO,
    highlights: WELCOME_HIGHLIGHTS,
    livePulse: WELCOME_LIVE_PULSE,
    onboarding: {
      steps: ONBOARDING_STEPS,
      actions: ONBOARDING_ACTIONS,
    },
  };
}

export function getHowToGuide() {
  return {
    intro: { title: "How to play Ludo", punch: "Four paying humans. One winner.", support: "One USDG per entry on Robinhood Chain mainnet; read BOARD Ludo v2 rules before paying." },
    steps: LUDO_LAUNCH_RULES.map((rule, index) => ({ id: `ludo-${index}`, number: index + 1, label: rule.title, title: rule.title, body: rule.text, answer: [{ type: "p", text: rule.text }] })),
    ctas: HOW_TO_CTAS,
  };
}

export function getWinGoalsGuide() {
  return {
    intro: WIN_GOAL_INTRO,
    games: WIN_GOALS,
  };
}

export function getRulesGuide() {
  return {
    intro: { title: "BOARD Ludo v2", support: "Custodial USDG entries. Only confirmed transfers are paid." },
    rules: LUDO_LAUNCH_RULES.map((rule, index) => ({ id: `ludo-${index}`, title: rule.title, body: rule.text, answer: [{ type: "p", text: rule.text }] })),
    example: {
      entryFee: 1, seats: 4, grossPot: 4, feePercent: 2,
      feeAmount: 0.08, winnerPayout: 3.92, treasuryAmount: 0.08, buybackAmount: 0, burnAmount: 0,
    },
    economy: { symbol: "USDG", custody: "operator treasury", prizeFeePercent: 2 },
    ctas: PRIZE_CTAS,
  };
}

export function getTokenGuide() {
  return {
    token: TOKEN_INFO,
    roadmap: ROADMAP,
  };
}

export function getGuideSection(section: GuideSection) {
  switch (section) {
    case "welcome":
      return getWelcomeGuide();
    case "how-to":
      return getHowToGuide();
    case "win-goals":
      return getWinGoalsGuide();
    case "rules":
      return getRulesGuide();
    case "token":
      return getTokenGuide();
  }
}

/** Full guide bundle for clients that want one round-trip. */
export function getFullGuide() {
  return {
    welcome: getWelcomeGuide(),
    howTo: getHowToGuide(),
    winGoals: getWinGoalsGuide(),
    rules: getRulesGuide(),
    token: getTokenGuide(),
    sections: [...GUIDE_SECTIONS],
  };
}
