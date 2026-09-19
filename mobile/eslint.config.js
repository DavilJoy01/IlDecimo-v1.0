// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // app.config.js runs under plain Node (via `require`), not the RN/browser
    // runtime the rest of the app targets, so it needs Node's globals.
    files: ["app.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      // This project's data-fetching hooks universally use a
      // `useEffect(() => { load(); }, [load])` mount-fetch pattern (14+
      // hooks). The rule's own fix -- moving to a fetching library across
      // the whole app -- is out of proportion to the lint finding, so this
      // is downgraded to a warning rather than silenced file-by-file.
      "react-hooks/set-state-in-effect": "warn",
      // react-native-reanimated's SharedValue.value is a documented,
      // intentional exception to React's immutability rules -- mutating it
      // outside render (e.g. in a Pressable's onPressIn) is how it drives
      // UI-thread animations without a re-render. The compiler's linter
      // doesn't know that pattern and flags it as if it were React state.
      "react-hooks/immutability": "warn",
    },
  },
]);
