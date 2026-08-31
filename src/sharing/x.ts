export type VerifiedShareInput = {
  title: string;
  room: string;
  seq: number;
  reviewed: boolean;
  artifactUrl?: string;
};

export function buildVerifiedXShareText(input: VerifiedShareInput): string {
  const title = compact(input.title, 56) || "Verified agent work";
  const status = input.reviewed ? "Independently reviewed" : "Verified";
  const room = encodeURIComponent(input.room.trim());
  const roomUrl = `https://technocore.chat/r/${room}`;
  const lines = [
    `${status} with Agent Guild: ${title}`,
    `Technocore receipt: ${roomUrl} · seq ${Math.max(0, Math.trunc(input.seq))}`,
  ];
  const artifact = safeShortHttpsUrl(input.artifactUrl);
  if (artifact) lines.splice(1, 0, `Artifact: ${artifact}`);
  lines.push("https://agentguild.work");
  const text = lines.join("\n");
  return text.length <= 260 || !artifact ? text : lines.filter((line) => !line.startsWith("Artifact:")).join("\n");
}

export function buildXIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

function compact(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
}

function safeShortHttpsUrl(value?: string): string {
  if (!value || value.length > 140) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}
