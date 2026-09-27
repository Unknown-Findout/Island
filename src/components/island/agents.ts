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
}

const LOOKS: Record<string, AgentLook> = {
  katie: { name: "Katie", from: "#C084FC", to: "#7C3AED", glow: "rgba(168,85,247,0.65)" },
  charles: { name: "Charles", from: "#FBBF24", to: "#B45309", glow: "rgba(245,158,11,0.55)" },
  astra: { name: "Astra", from: "#67E8F9", to: "#0E7490", glow: "rgba(34,211,238,0.55)" },
  quill: { name: "Quill", from: "#5EEAD4", to: "#0F766E", glow: "rgba(45,212,191,0.55)" },
  jessica: { name: "Jessica", from: "#FDA4AF", to: "#BE123C", glow: "rgba(244,63,94,0.55)" },
  hex: { name: "Hex", from: "#86EFAC", to: "#15803D", glow: "rgba(34,197,94,0.55)" },
  glm: { name: "GLM", from: "#93C5FD", to: "#1D4ED8", glow: "rgba(59,130,246,0.55)" },
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
