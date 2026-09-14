import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const skipDirs = new Set([".git", "node_modules", "public-dist"]);
const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".zip", ".pdf", ".mp3", ".wav", ".woff", ".woff2", ".ttf"]);

const patterns = [
  { name: "private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { name: "OpenAI-style secret", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "JWT-like token", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "Razorpay live/test secret assignment", regex: /(?:RAZORPAY_KEY_SECRET|RAZORPAY_WEBHOOK_SECRET)\s*[:=]\s*["'][^"'\n]{8,}["']/gi },
  { name: "Supabase service-role assignment", regex: /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"'\n]{20,}["']/gi },
  { name: "internal signing/rate-limit secret assignment", regex: /(?:VERIFIED_RUN_SIGNING_SECRET|RATE_LIMIT_SECRET)\s*[:=]\s*["'][^"'\n]{16,}["']/gi },
  { name: "generic secret/token assignment", regex: /(?:api[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-./+=]{16,}["']/gi }
];

function extension(path) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

async function walk(dirUrl, files = []) {
  for (const entry of await readdir(dirUrl, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".github" && entry.name !== ".gitignore") continue;
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const next = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
    if (entry.isDirectory()) await walk(next, files);
    else files.push(next);
  }
  return files;
}

const findings = [];
for (const fileUrl of await walk(root)) {
  const path = fileUrl.pathname;
  if (binaryExtensions.has(extension(path))) continue;
  const fileStat = await stat(fileUrl);
  if (fileStat.size > 1_000_000) continue;
  let content;
  try {
    content = await readFile(fileUrl, "utf8");
  } catch {
    continue;
  }
  const repoPath = relative(new URL("../", import.meta.url).pathname, path);
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (const match of content.matchAll(pattern.regex)) {
      const before = content.slice(0, match.index ?? 0);
      const line = before.split("\n").length;
      findings.push(`${repoPath}:${line}: ${pattern.name}`);
    }
  }
}

if (findings.length) {
  console.error("Potential secrets detected:\n" + findings.join("\n"));
  process.exit(1);
}

console.log("Repository-wide secret pattern scan passed.");
