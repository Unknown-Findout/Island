/**
 * How each seat in the house looks in the island. The island has no contact
 * photos, so each agent is a lettered disc in its own colour, the way Messages
 * shows a contact without a picture.
 */
export interface AgentLook {
  name: string;
  /** Two gradient stops for the disc, lighter first. */
  from: string;
  to: string;
  /** The glow while this agent is thinking. */
  glow: string;
  /** A full background for the disc when two stops are not enough. */
  bg?: string;
}

// The agents talking as of 2026-09-27, per Wesley: Katie, Charles, Astra.
// Katie purple, Charles orange, Astra a cosmic blue (his picks). Anyone else
// who posts gets a neutral grey disc rather than a colour of their own.
const LOOKS: Record<string, AgentLook> = {
  katie: { name: "Katie", from: "#C084FC", to: "#7C3AED", glow: "rgba(168,85,247,0.65)" },
  charles: { name: "Charles", from: "#FDBA74", to: "#EA580C", glow: "rgba(249,115,22,0.6)" },
  astra: {
    name: "Astra",
    from: "#7DD3FC",
    to: "#1E3A8A",
    glow: "rgba(56,130,246,0.6)",
    // Cosmic: a bright core off-centre fading through blue into deep space,
    // with two pinpoint stars, so it reads as a sky rather than a flat blue.
    bg:
      "radial-gradient(circle at 72% 30%, rgba(255,255,255,0.9) 0 1px, transparent 1.5px)," +
      "radial-gradient(circle at 30% 70%, rgba(255,255,255,0.7) 0 0.8px, transparent 1.3px)," +
      "radial-gradient(circle at 35% 30%, #7DD3FC 0%, #2563EB 42%, #1E1B4B 100%)",
  },
  wesley: { name: "Wesley", from: "#F5F5F5", to: "#737373", glow: "rgba(255,255,255,0.4)" },
};

export function agentLook(agent: string): AgentLook {
  const key = agent.toLowerCase();
  return (
    LOOKS[key] ?? {
      name: agent.charAt(0).toUpperCase() + agent.slice(1),
      from: "#A3A3A3",
      to: "#404040",
      glow: "rgba(255,255,255,0.35)",
    }
  );
}
