import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protectedDidSha256 = "32ab904c35c183fc9e6a1af9947f862e0fc7e2b8a58dd444631b1cda8ece60f7";
const didPattern = /did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}/g;
const findings = [];

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const productionBuild = packageJson.scripts?.["build:production"] || "";
const requiredProductionBuildSettings = [
  "VITE_EDGE_ORIGIN=https://agent-guild-edge.agent-guild.workers.dev",
  "VITE_PUBLIC_WRITES=true",
  "VITE_CONNECTOR_PUBLISHED=true",
];
for (const setting of requiredProductionBuildSettings) {
  if (!productionBuild.includes(setting)) findings.push({ path: "package.json", label: `production build missing ${setting}` });
}
if (!String(packageJson.scripts?.check || "").includes("npm run build:production")) {
  findings.push({ path: "package.json", label: "release check does not build the production bundle" });
}

const workerConfig = readFileSync(join(root, "wrangler.toml"), "utf8");
if (!/PUBLIC_WRITES\s*=\s*"true"/.test(workerConfig)) {
  findings.push({ path: "wrangler.toml", label: "production Worker writes are disabled" });
}
if (!/APP_ORIGIN\s*=\s*"https:\/\/agentguild\.work"/.test(workerConfig)) {
  findings.push({ path: "wrangler.toml", label: "production Worker origin is not agentguild.work" });
}

const releaseFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbiddenTrackedPaths = [
  [/(^|\/)\.dev\.vars(?:\.|$)/i, "Cloudflare local secret file"],
  [/(^|\/)\.env(?:\.|$)/i, "environment file"],
  [/agent-guild-pairing.*\.json$/i, "pairing file"],
  [/agent-guild-identity.*\.json$/i, "identity backup"],
  [/agent-guild-ledger.*\.json$/i, "ledger backup"],
  [/(^|\/)vault\//i, "vault directory"],
  [/(^|\/)receipts\/private\//i, "private receipt directory"],
  [/\.(?:pem|key|p12|pfx)$/i, "private key or certificate container"],
];

const contentRules = [
  [/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, "PEM private key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/, "GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}\b/, "API secret key"],
  [/"d"\s*:\s*"[A-Za-z0-9_-]{43}"/, "private JWK material"],
  [/"encryptionKey"\s*:\s*"[A-Za-z0-9_-]{43}"/, "pairing encryption key"],
];

for (const path of releaseFiles) {
  if (path === ".env.example" || path === ".env.staging.example") continue;
  for (const [pattern, label] of forbiddenTrackedPaths) {
    if (pattern.test(path)) findings.push({ path, label });
  }
}

const scanned = new Set(releaseFiles);
if (existsSync(join(root, "dist"))) {
  for (const path of walk(join(root, "dist"))) scanned.add(relative(root, path));
}

for (const path of scanned) {
  const absolute = join(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile() || statSync(absolute).size > 5_000_000) continue;
  let text;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    continue;
  }

  for (const did of text.match(didPattern) || []) {
    const digest = createHash("sha256").update(did).digest("hex");
    if (digest === protectedDidSha256) findings.push({ path, label: "protected DID" });
  }
  for (const [pattern, label] of contentRules) {
    if (pattern.test(text)) findings.push({ path, label });
  }
  if (path.startsWith("dist/") && /\b(?:Nova|Moss|ProofPacket)\b/.test(text)) {
    findings.push({ path, label: "unrelated project or retired demo-agent marker" });
  }
}

const unique = [...new Map(findings.map((item) => [`${item.path}:${item.label}`, item])).values()];
if (unique.length) {
  console.error(`Release audit failed with ${unique.length} finding(s):`);
  for (const item of unique) console.error(`- ${item.path}: ${item.label}`);
  process.exit(1);
}

console.log(`Release audit passed: ${releaseFiles.length} release files and ${scanned.size - releaseFiles.length} build files checked.`);

function walk(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}
