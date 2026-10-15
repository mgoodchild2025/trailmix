// iOS 27 stops apps at launch unless they adopt the UIScene life cycle. Expo 57 ships
// ExpoAppSceneDelegate for this but its project template doesn't use it yet, so this
// plugin wires it in whenever the native project is generated:
//   1. AppDelegate conforms to ExpoReactNativeFactoryProvider and no longer creates the
//      window itself (the scene delegate creates it and starts React Native).
//   2. Info.plist declares a scene configuration that uses EXExpoAppSceneDelegate.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const START_BLOCK = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') throw new Error('with-scene-lifecycle expects a Swift AppDelegate');
    let src = cfg.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    }
    if (START_BLOCK.test(src)) {
      src = src.replace(START_BLOCK, '\n    // The window and React Native are started by ExpoAppSceneDelegate (UIScene life cycle).\n');
    } else if (src.includes('UIWindow(frame: UIScreen.main.bounds)')) {
      throw new Error('with-scene-lifecycle: AppDelegate changed shape; update the plugin');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withSceneManifest(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return cfg;
  });
}

module.exports = (config) => withSceneManifest(withSceneAppDelegate(config));
