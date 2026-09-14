require('dotenv').config({ path: '.env.local' });

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...config.plugins,
    [
      'react-native-maps',
      { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY_ANDROID },
    ],
  ],
});
