#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 ]]; then
  echo "Usage: bash mobile/scripts/local-android/build.sh OUTPUT_DIRECTORY" >&2
  exit 2
fi

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
mkdir -p "$1"
output_dir=$(cd "$1" && pwd)
image=orca-local-android:24-sdk37

docker build --platform linux/amd64 -t "$image" - < "$repo_dir/mobile/scripts/local-android/Dockerfile"
docker run --rm -i --platform linux/amd64 \
  --mount "type=bind,source=$repo_dir,target=/src" \
  --mount "type=bind,source=$output_dir,target=/output" \
  --mount type=volume,source=orca-chat-android-signing,target=/signing \
  --mount type=volume,source=orca-chat-android-gradle,target=/root/.gradle \
  --env ORCA_ANDROID_SIDELOAD=1 \
  "$image" bash -se <<'BUILD'
corepack pnpm install --frozen-lockfile
corepack pnpm exec expo prebuild --platform android --no-install --clean

if [[ ! -e /signing/orca-chat.p12 ]]; then
  (
    umask 077
    if [[ ! -e /signing/password ]]; then
      openssl rand -hex 32 > /signing/password
    fi
    keytool -genkeypair -keystore /signing/orca-chat.p12 -storetype PKCS12 \
      -storepass:file /signing/password -alias orca-chat -keyalg RSA -keysize 3072 \
      -validity 10000 -dname 'CN=Orca Chat Local'
  )
fi

export ORCA_ANDROID_REQUIRE_RELEASE_SIGNING=true
export ORCA_ANDROID_KEYSTORE_PATH=/signing/orca-chat.p12
export ORCA_ANDROID_KEY_ALIAS=orca-chat
export ORCA_ANDROID_KEYSTORE_PASSWORD="$(cat /signing/password)"
export ORCA_ANDROID_KEY_PASSWORD="$ORCA_ANDROID_KEYSTORE_PASSWORD"

cd android
./gradlew --no-daemon --max-workers=2 :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
apk=app/build/outputs/apk/release/app-release.apk
tools="$ANDROID_HOME/build-tools/37.0.0"
"$tools/apksigner" verify --print-certs "$apk"
"$tools/aapt" dump badging "$apk" | grep "^package: name='dev.orca.chat'"
unzip -l "$apk" assets/index.android.bundle
unzip -Z1 "$apk" | grep -qx assets/index.android.bundle
cp "$apk" /output/orca-chat-arm64.apk
cd /output
sha256sum orca-chat-arm64.apk
adb devices -l
BUILD
