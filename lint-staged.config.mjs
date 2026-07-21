export default {
  "*.{js,mjs,cjs,ts,tsx}": ["prettier --write", "eslint --fix --max-warnings=0"],
  "*.{css,html,json,jsonc,md,yaml,yml}": ["prettier --write"],
};
