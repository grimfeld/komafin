/** Architecture rules. See CONSTRAINTS.md → Architecture. */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular imports make modules impossible to reason about in isolation.",
      from: {},
      to: { circular: true },
    },
    {
      name: "http-clients-only-in-jellyfin-client",
      severity: "error",
      comment: "All network access goes through src/lib/jellyfin/.",
      from: { pathNot: "^src/lib/jellyfin/" },
      to: { path: "(^|/)node_modules/(@tauri-apps/plugin-http|ky|axios)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
  },
};
