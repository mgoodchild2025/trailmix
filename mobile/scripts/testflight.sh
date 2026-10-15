#!/bin/zsh
# Builds the iPhone app and uploads it to App Store Connect for TestFlight.
# Signing is automatic through the Apple account signed in to Xcode (Settings, Accounts).
# Bump expo.ios.buildNumber in app.json before each upload (App Store Connect rejects repeats).
set -euo pipefail
cd "$(dirname "$0")/.."
TEAM=LM4G49467Q
OUT=build/ios
rm -rf "$OUT"; mkdir -p "$OUT"

echo "› Generating the native project"
CI=1 npx expo prebuild --platform ios --clean >/dev/null

echo "› Archiving (Release)"
xcodebuild -workspace ios/Trailmix.xcworkspace -scheme Trailmix -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/Trailmix.xcarchive" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=$TEAM CODE_SIGN_STYLE=Automatic \
  archive -quiet

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>${DESTINATION:-upload}</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

echo "› Signing for the App Store and ${DESTINATION:-upload}ing"
xcodebuild -exportArchive -archivePath "$OUT/Trailmix.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates

echo "✓ Done. The build appears in App Store Connect → TestFlight after Apple processes it (5–30 min)."
