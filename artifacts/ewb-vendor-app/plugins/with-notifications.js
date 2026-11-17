const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');

/**
 * Push notifications on Android (FCM, see lib/push.native.ts):
 * - an "Updates" channel with high importance, so notifications pop up from the top
 *   (the server sends them on channel "updates", lib/notify.ts on the API);
 * - a white bell as the small notification icon.
 */
const ICON = `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF" android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.89,2 2,2zM18,16v-5c0,-3.07 -1.64,-5.64 -4.5,-6.32L13.5,4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.63,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z"/>
</vector>
`;

const CHANNEL = `
  /** "Updates": credits, payments and e-way bills. High importance, so they pop up from the top. */
  private fun createNotificationChannel() {
    if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.O) return
    val channel = android.app.NotificationChannel("updates", "Updates", android.app.NotificationManager.IMPORTANCE_HIGH)
    channel.description = "Credits added, payments and e-way bills generated"
    getSystemService(android.app.NotificationManager::class.java)?.createNotificationChannel(channel)
  }
`;

module.exports = function withNotifications(config) {
  config = withMainApplication(config, (mod) => {
    let src = mod.modResults.contents;
    if (!src.includes('createNotificationChannel()')) {
      src = src.replace('super.onCreate()', 'super.onCreate()\n    createNotificationChannel()');
      src = src.replace(/\n}\s*$/, `${CHANNEL}}\n`);
    }
    mod.modResults.contents = src;
    return mod;
  });
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application[0];
    app['meta-data'] = app['meta-data'] ?? [];
    if (!app['meta-data'].some((item) => item.$['android:name'] === 'com.google.firebase.messaging.default_notification_icon')) {
      app['meta-data'].push({ $: { 'android:name': 'com.google.firebase.messaging.default_notification_icon', 'android:resource': '@drawable/ic_notification' } });
    }
    return mod;
  });
  return withDangerousMod(config, ['android', (mod) => {
    const dir = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ic_notification.xml'), ICON);
    return mod;
  }]);
};
