// google-services.json is not committed (the repo is public). EAS builds get it from
// the GOOGLE_SERVICES_JSON file variable; local builds read ./google-services.json.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
