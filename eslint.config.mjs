import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.stryker-tmp/**",
      "**/.vite/**",
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/reports/**",
      "docs/api/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      sourceType: "module",
    },
  },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
      sourceType: "module",
    },
    plugins: {
      import: importPlugin,
      "simple-import-sort": simpleImportSort,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: [
            "./tsconfig.eslint.json",
            "./packages/*/tsconfig.json",
            "./examples/*/tsconfig.json",
          ],
        },
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "separate-type-imports",
          prefer: "type-imports",
        },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "array-callback-return": "error",
      eqeqeq: ["error", "always"],
      "import/extensions": [
        "error",
        "ignorePackages",
        {
          js: "never",
          jsx: "never",
          ts: "never",
          tsx: "never",
        },
      ],
      "import/no-unresolved": [
        "error",
        {
          caseSensitive: true,
          commonjs: true,
        },
      ],
      "no-console": [
        "error",
        {
          allow: ["error", "log", "table", "warn"],
        },
      ],
      "padding-line-between-statements": [
        "error",
        {
          blankLine: "always",
          next: "*",
          prev: "import",
        },
        {
          blankLine: "any",
          next: "import",
          prev: "import",
        },
        // Group consecutive same-kind declarators; blank line when kind changes.
        {
          blankLine: "never",
          next: "const",
          prev: "const",
        },
        {
          blankLine: "never",
          next: "let",
          prev: "let",
        },
        {
          blankLine: "never",
          next: "var",
          prev: "var",
        },
        {
          blankLine: "always",
          next: ["let", "var"],
          prev: "const",
        },
        {
          blankLine: "always",
          next: ["const", "var"],
          prev: "let",
        },
        {
          blankLine: "always",
          next: ["const", "let"],
          prev: "var",
        },
        {
          blankLine: "always",
          next: "*",
          prev: "block-like",
        },
        {
          blankLine: "always",
          next: [
            "block",
            "break",
            "class",
            "continue",
            "debugger",
            "do",
            "export",
            "expression",
            "for",
            "function",
            "if",
            "iife",
            "return",
            "switch",
            "throw",
            "try",
            "while",
          ],
          prev: ["const", "let", "var"],
        },
        {
          blankLine: "always",
          next: ["if", "for", "while", "switch", "try", "function"],
          prev: "*",
        },
        {
          blankLine: "always",
          next: "return",
          prev: "*",
        },
      ],
      "simple-import-sort/exports": "error",
      "simple-import-sort/imports": "error",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/consistent-indexed-object-style": "off",
    },
  },
  {
    files: ["**/*.test.ts", "**/benchmarks/**/*.ts", "**/examples/**/*.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-magic-numbers": "off",
    },
  },
  prettier,
  // Prettier disables some stylistic rules; keep braces required after that merge.
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {
      curly: ["error", "all"],
    },
  },
);
