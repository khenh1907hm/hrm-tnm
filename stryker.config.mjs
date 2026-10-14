const config = {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  mutate: ["src/lib/**/*.ts", "src/modules/**/*.ts", "!src/**/*.test.ts", "!src/**/*.spec.ts"],
  reporters: ["clear-text", "progress", "html", "json"],
  coverageAnalysis: "perTest",
  concurrency: 4,
  timeoutMS: 10000,
  vitest: { configFile: "vitest.config.ts", related: true },
  thresholds: { high: 90, low: 90, break: 90 },
};

export default config;
