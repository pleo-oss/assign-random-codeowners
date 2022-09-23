module.exports = {
  env: {
    "es2021": true,
    "jest": true
  },
  extends: [
    'eslint:recommended', 
    'plugin:@typescript-eslint/recommended',
    "prettier"
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  root: true,
  settings: {
    "import/resolver": {
      "typescript": {}
    }
  }
}