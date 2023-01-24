module.exports = {
  root: true,
  env: {
    'browser': true,
    'node': true,
  },
  extends: [
    'eslint:recommended',
    'google',
    'plugin:jest/recommended',
    'plugin:jest/style',
  ],
  parserOptions: {
    'ecmaVersion': 2022,
  },
  plugins: ['jest'],
  rules: {
    'require-jsdoc': 'off',
    'max-len': ['error', {
      'ignoreStrings': true,
      'ignoreTemplateLiterals': true,
      'ignoreRegExpLiterals': true,
      'ignoreUrls': true,
      'code': 120,
    }],
    'jest/no-disabled-tests': ['error'],
  },
};
