import tseslint from "typescript-eslint";

export default tseslint.config({ ignores: ["docs/**", "fixtures/**", "data/**", "logs/**", "build/**", "**/dist/**"] }, ...tseslint.configs.recommended, {
  // 観察サーバーに書き込みの処理を持ち込ませない（BE 詳細設計 observer 6章）
  files: ["apps/server/src/observer/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", { patterns: ["**/generation/actionApplier*", "**/admin/**"] }],
  },
});
