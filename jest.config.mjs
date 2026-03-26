export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@actions/github$": "<rootDir>/src/__tests__/mocks/actions-github.ts",
  },
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["src/**/*.ts", "!src/__tests__/**/*.ts"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["dist"],
};
