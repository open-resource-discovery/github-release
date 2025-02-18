import { withCustomConfig } from "@sap/eslint-config";

const conf = withCustomConfig([
  {
    ignores: ["dist"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/ban-ts-ignore": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
]);

export default conf;
