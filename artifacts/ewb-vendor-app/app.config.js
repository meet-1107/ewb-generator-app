const fs = require('fs');
const path = require('path');

// google-services.json is not committed (the repo is public). EAS builds get it from
// the GOOGLE_SERVICES_JSON file variable; local builds read ./google-services.json.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';

// Google Sign-In needs Firebase's "Web client" OAuth ID (client_type 3). It appears in
// google-services.json once the Google provider is enabled in Firebase Authentication.
function googleWebClientId() {
  if (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) return process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  try {
    const json = JSON.parse(fs.readFileSync(path.resolve(__dirname, googleServicesFile), 'utf8'));
    const clients = (json.client ?? []).flatMap((client) => client.oauth_client ?? []);
    return clients.find((client) => client.client_type === 3)?.client_id;
  } catch {
    return undefined;
  }
}

module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android, googleServicesFile },
  extra: { ...config.extra, googleWebClientId: googleWebClientId() },
});
