// Accessibility check (CONSTRAINTS.md): axe-core in headless Chromium against the Vite
// dev server. Fails on any critical or serious violation. Usage: node scripts/a11y.mjs [url]
// Starts `vite` itself if nothing is listening on the URL.
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";

const url = process.argv[2] ?? "http://localhost:1420";
const up = () =>
  fetch(url).then(
    () => true,
    () => false
  );

let server = null;
if (!(await up())) {
  server = spawn("pnpm", ["exec", "vite", "--strictPort"], { stdio: "ignore" });
  for (let i = 0; i < 50 && !(await up()); i++)
    await new Promise((r) => setTimeout(r, 200));
  if (!(await up())) {
    server.kill();
    console.error("a11y: dev server did not start");
    process.exit(2);
  }
}

let code;
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const blocking = violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  for (const v of violations) {
    console.log(
      `${blocking.includes(v) ? "FAIL" : "info"} [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`
    );
  }
  console.log(
    `a11y: ${blocking.length} critical/serious, ${violations.length - blocking.length} other`
  );
  code = blocking.length ? 1 : 0;
} finally {
  await browser.close();
  server?.kill();
}
process.exit(code);
