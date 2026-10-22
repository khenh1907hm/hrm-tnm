import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    ".stryker-tmp/**",
    "public/tesseract/**",
    "next-env.d.ts",
    // Edge Function chạy trên Deno, có cấu hình riêng; hoSoRules.mjs là tệp đóng gói tự động
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
