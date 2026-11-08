// Dependency vulnerability gate (CONSTRAINTS.md → Security: deps). Runs osv-scanner and fails only
// on findings at CVSS >= 7.0 (high or critical); lower and unscored findings are listed, not blocking.
// Exit: 0 pass, 1 high+ finding, 2 scanner could not run.
import { spawnSync } from "node:child_process";

const r = spawnSync(
  "osv-scanner",
  ["scan", "source", "-r", ".", "--format", "json"],
  {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }
);
// osv-scanner: 0 = no vulns, 1 = vulns found, 128 = no packages; anything else is a failure.
if (r.error || ![0, 1, 128].includes(r.status)) {
  console.error(
    "osv-gate: osv-scanner failed to run",
    r.error?.message ?? r.stderr
  );
  process.exit(2);
}
const out = r.stdout.trim() ? JSON.parse(r.stdout) : { results: [] };
const HIGH = 7.0;
let blocking = 0;
for (const res of out.results ?? []) {
  for (const pkg of res.packages ?? []) {
    for (const g of pkg.groups ?? []) {
      const score = g.max_severity ? Number(g.max_severity) : null;
      const high = score !== null && score >= HIGH;
      if (high) blocking++;
      console.log(
        `${high ? "FAIL" : "info"} ${pkg.package.ecosystem} ${pkg.package.name}@${pkg.package.version} ` +
          `[${score ?? "unscored"}] ${g.ids.join(", ")}`
      );
    }
  }
}
console.log(`osv-gate: ${blocking} finding(s) at CVSS >= ${HIGH}`);
process.exit(blocking ? 1 : 0);
