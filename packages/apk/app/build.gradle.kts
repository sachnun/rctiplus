plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.rctiplus.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.rctiplus.tv"
        minSdk = 21
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        getByName("debug") {
            // Stable keystore committed with the project so debug APKs can be
            // upgraded in place (install -r) across container rebuilds.
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.fragment.ktx)
    implementation(libs.androidx.leanback)
    implementation(libs.androidx.media3.exoplayer)
    implementation(libs.androidx.media3.hls)
    implementation(libs.androidx.media3.ui)
    implementation(libs.androidx.lifecycle.runtime.ktx)
}