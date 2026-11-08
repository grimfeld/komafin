import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// See CONSTRAINTS.md. Network access lives only in src/lib/jellyfin/.
export default tseslint.config(
  { ignores: ["dist", "coverage", "src-tauri", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Network calls go through the Jellyfin client in src/lib/jellyfin/ (CONSTRAINTS.md).",
        },
        {
          name: "XMLHttpRequest",
          message: "Use the Jellyfin client in src/lib/jellyfin/.",
        },
      ],
    },
  },
  {
    files: ["src/lib/jellyfin/**"],
    rules: { "no-restricted-globals": "off" },
  },
  {
    files: ["scripts/**", "*.config.{js,ts}", "*.cjs"],
    languageOptions: { globals: globals.node },
  }
);
