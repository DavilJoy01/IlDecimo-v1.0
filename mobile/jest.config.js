module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    // NOTE: `expo(nent)?` is extended with `[\\w.-]*` so it also matches unscoped
    // packages like `expo-modules-core`, `expo-router`, `expo-constants`, etc.
    // (the literal `expo(nent)?` alone only matches the bare `expo` package name,
    // which excludes every other `expo-*` package from transformation and breaks
    // on their untranspiled ESM/TS source under the current jest-expo/SDK versions).
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?[\\w.-]*|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)/)',
  ],
  setupFilesAfterEnv: [],
};
