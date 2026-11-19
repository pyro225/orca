FROM node:24-bookworm@sha256:9d266751ca3d7fdbe651c878ffd5ad0a42fed49a18c283509267c97f025b7496
RUN apt-get update && apt-get install -y --no-install-recommends openjdk-17-jdk-headless unzip && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    ANDROID_HOME=/opt/android-sdk \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=1
ENV PATH=/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:$PATH
RUN curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip -o /tmp/sdk.zip \
    && echo '04453066b540409d975c676d781da1477479dde3761310f1a7eb92a1dfb15af7  /tmp/sdk.zip' | sha256sum -c - \
    && mkdir -p "$ANDROID_HOME/cmdline-tools" \
    && unzip -q /tmp/sdk.zip -d /tmp/android-sdk \
    && mv /tmp/android-sdk/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest" \
    && rm /tmp/sdk.zip \
    && yes | sdkmanager --licenses >/dev/null \
    && sdkmanager 'platforms;android-37.0' 'build-tools;37.0.0' 'ndk;27.1.12297006' 'cmake;3.22.1' 'platform-tools'
WORKDIR /src/mobile
