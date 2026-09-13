import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const PUBLIC_FILES = Object.freeze([
  "CNAME", "contact.html", "engine-audio.js", "favicon.svg", "game-config.js",
  "index.html", "legal.css", "music-config.js", "parents.html", "payment-config.js",
  "payment-policy.js", "payment.css", "privacy.html", "refund.html", "robots.txt",
  "script.js", "site.webmanifest", "sitemap.xml", "skin-policy.js", "spotify-player.js",
  "style.css", "terms.html", "weather.js"
]);

export async function buildPages(output = "public-dist") {
  const destination = resolve(output);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of PUBLIC_FILES) await cp(resolve(file), resolve(destination, file));
  await cp(resolve("supabase/functions/_shared/racing-engine.js"), resolve(destination, "racing-engine.js"));
  const scriptPath = resolve(destination, "script.js");
  const script = await readFile(scriptPath, "utf8");
  await writeFile(scriptPath, script.replace("./supabase/functions/_shared/racing-engine.js", "./racing-engine.js"));
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) await buildPages(process.argv[2]);
