#!/bin/zsh
# Builds the signed Android app and publishes it as a GitHub release tagged
# android-v<version> (never marked "latest", so the desktop auto-update feed is untouched).
#
#   scripts/android-release.sh            build + publish
#   BUILD_ONLY=1 scripts/android-release.sh   build and check the signature only
#
# Needs the signing key from scripts/android-keystore.sh. Bump expo.version and
# expo.android.versionCode in app.json first (Android refuses a repeated versionCode).
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}
export ANDROID_HOME=${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
REPO=mgoodchild2025/trailmix
VERSION=$(node -p 'require("./app.json").expo.version')
CODE=$(node -p 'require("./app.json").expo.android.versionCode')
TAG=android-v$VERSION
OUT=build/android
APK=$OUT/Trailmix-$VERSION.apk

export TRAILMIX_ANDROID_KEYSTORE=~/.private_keys/trailmix-android.keystore
[[ -f $TRAILMIX_ANDROID_KEYSTORE ]] || { echo "No signing key; run scripts/android-keystore.sh first."; exit 1; }
export TRAILMIX_ANDROID_KEYSTORE_PASSWORD=$(security find-generic-password -s trailmix-android-keystore -a trailmix -w)

if [[ -z ${BUILD_ONLY:-} ]] && gh release view $TAG -R $REPO >/dev/null 2>&1; then
  echo "Release $TAG already exists; bump expo.version in app.json."; exit 1
fi

echo "› Building Trailmix $VERSION ($CODE) for Android"
CI=1 npx expo prebuild --platform android --clean >/dev/null
(cd android && ./gradlew assembleRelease --no-daemon -q)
mkdir -p $OUT
cp android/app/build/outputs/apk/release/app-release.apk $APK

echo "› Checking the signature"
APKSIGNER=$(ls -d $ANDROID_HOME/build-tools/*/ | sort -V | tail -1)apksigner
"$APKSIGNER" verify --print-certs $APK | grep -q "CN=CG Technologies Corp" || { echo "APK is not signed with the CG key"; exit 1; }
echo "  signed by CG Technologies Corp"
unset TRAILMIX_ANDROID_KEYSTORE_PASSWORD

[[ -n ${BUILD_ONLY:-} ]] && { echo "✓ Built $APK"; exit 0; }

echo "› Publishing $TAG"
gh release create $TAG $APK -R $REPO --latest=false --title "Trailmix for Android $VERSION" \
  --notes "Trailmix for Android $VERSION. Download Trailmix-$VERSION.apk on the phone, open it and allow installing from your browser if asked. Installed copies offer each new version on the Meetings screen."
echo "✓ https://github.com/$REPO/releases/download/$TAG/Trailmix-$VERSION.apk"
