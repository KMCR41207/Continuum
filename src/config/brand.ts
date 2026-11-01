export const brand = {
  name: "Continuum",
  wordmark: "Continuum",
  monogram: "C",
  tagline: "One memory. Every intelligence.",
  primaryColor: "#3158C9",
  favicon: "/favicon.svg",
  metadata: {
    title: "Continuum — One memory. Every intelligence.",
    description:
      "Keep conversations, decisions, preferences, and project knowledge connected across your AI tools.",
  },
  social: {
    title: "Continuum — Your intelligence, carried forward.",
    description: "A user-controlled memory layer for your AI tools.",
  },
  typography: { display: "Relona", licensedAssetAvailable: false },
} as const;
export const plans = [
  {
    id: "free",
    name: "Free",
    description: "Start connecting the dots.",
    price: null,
    features: [
      "Personal workspace",
      "Manual conversation import",
      "Source-linked memories",
      "Memory review and corrections",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    description: "For your everyday thinking.",
    price: null,
    features: [
      "Everything in Free",
      "Higher memory capacity",
      "More connected agents",
      "Project-aware context",
    ],
  },
  {
    id: "max",
    name: "Max",
    description: "Room for your most ambitious work.",
    price: null,
    features: [
      "Everything in Pro",
      "Expanded processing limits",
      "More project storage",
      "Advanced agent access",
    ],
  },
  {
    id: "teams",
    name: "Teams",
    description: "A shared foundation for your team.",
    price: null,
    features: [
      "Shared workspaces",
      "Team administration",
      "Project permissions",
      "Shared project knowledge",
    ],
  },
] as const;
