import js from "@eslint/js"

export default [
  { ignores: ["coverage/**"] },
  js.configs.recommended,
  {
    files: ["test/**/*.mjs"],
    languageOptions: { globals: { structuredClone: "readonly" } },
  },
]
