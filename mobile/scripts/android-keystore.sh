#!/bin/zsh
# Creates CG Technologies' Android signing key for Trailmix, once.
#
#   key file:  ~/.private_keys/trailmix-android.keystore (mode 600)
#   password:  random, stored only in the macOS login keychain
#              (service "trailmix-android-keystore"); never printed
#
# Every Android update must be signed with this same key, or installed copies refuse it.
# Back up both the file and the password (Keychain Access → "trailmix-android-keystore")
# to the company password manager.
set -euo pipefail
JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}
STORE=~/.private_keys/trailmix-android.keystore
SERVICE=trailmix-android-keystore

if [[ -e $STORE ]]; then
  echo "A key already exists at $STORE — not replacing it."
  exit 1
fi
mkdir -p ~/.private_keys && chmod 700 ~/.private_keys

export TRAILMIX_KS_PW=$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)
security add-generic-password -U -s $SERVICE -a trailmix -w "$TRAILMIX_KS_PW"
"$JAVA_HOME/bin/keytool" -genkeypair -v -keystore $STORE -storetype PKCS12 -alias trailmix \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=CG Technologies Corp, O=CG Technologies Corp, L=Concord, ST=Ontario, C=CA" \
  -storepass:env TRAILMIX_KS_PW -keypass:env TRAILMIX_KS_PW >/dev/null 2>&1
unset TRAILMIX_KS_PW
chmod 600 $STORE
echo "Created $STORE; password saved in the keychain as \"$SERVICE\"."
