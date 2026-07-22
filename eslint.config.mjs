import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "docs/**", ".next/**", "worker/**", "db/**", "build/**", "scripts/**", "vite.config.ts"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { window: "readonly", document: "readonly", crypto: "readonly", Image: "readonly", URL: "readonly", Blob: "readonly", File: "readonly", HTMLImageElement: "readonly", HTMLCanvasElement: "readonly", fetch: "readonly", process: "readonly" },
    },
  },
);
