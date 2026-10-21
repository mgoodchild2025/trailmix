// Android release builds: sign with CG Technologies' key when it's available, and
// build for phone (ARM) processors only.
//
// scripts/android-release.sh sets TRAILMIX_ANDROID_KEYSTORE (path) and
// TRAILMIX_ANDROID_KEYSTORE_PASSWORD (read from the macOS keychain, never stored in
// the project). Without them, release builds keep Expo's debug signing, which is fine
// for testing on an emulator but can't update an installed copy signed with the real key.
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const MARK = '// trailmix-release-signing';

// Phones are ARM; leaving out the x86 builds (emulators on Intel PCs, Chromebooks)
// roughly halves the download.
function withPhoneArchitectures(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => p.key !== 'reactNativeArchitectures');
    cfg.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value: 'armeabi-v7a,arm64-v8a' });
    return cfg;
  });
}

module.exports = function withAndroidSigning(config) {
  config = withPhoneArchitectures(config);
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARK)) return cfg;

    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        ${MARK}
        if (System.getenv('TRAILMIX_ANDROID_KEYSTORE')) {
            release {
                storeFile file(System.getenv('TRAILMIX_ANDROID_KEYSTORE'))
                storePassword System.getenv('TRAILMIX_ANDROID_KEYSTORE_PASSWORD')
                keyAlias 'trailmix'
                keyPassword System.getenv('TRAILMIX_ANDROID_KEYSTORE_PASSWORD')
            }
        }`,
    );
    // In buildTypes.release, use the release key when it was configured above.
    gradle = gradle.replace(
      /(release\s*\{[^{}]*?)signingConfig signingConfigs\.debug/,
      `$1signingConfig System.getenv('TRAILMIX_ANDROID_KEYSTORE') ? signingConfigs.release : signingConfigs.debug`,
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
