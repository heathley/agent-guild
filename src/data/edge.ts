const configuredOrigin = (import.meta.env.VITE_EDGE_ORIGIN || "").trim().replace(/\/$/, "");

export function edgeUrl(path: string): string {
  if (!path.startsWith("/api/")) throw new Error("Edge paths must stay inside /api/.");
  return `${configuredOrigin}${path}`;
}

export function edgeOrigin(): string {
  return configuredOrigin || window.location.origin;
}
