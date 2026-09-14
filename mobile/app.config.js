const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });

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
