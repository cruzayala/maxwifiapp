pluginManagement { repositories {
    maven {
        url = uri(providers.gradleProperty("googleMavenUrl").orElse("https://dl.google.com/dl/android/maven2/").get())
        content { includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google.*"); includeGroupByRegex("androidx.*") }
    }
    mavenCentral(); gradlePluginPortal()
} }
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven {
            url = uri(providers.gradleProperty("googleMavenUrl").orElse("https://dl.google.com/dl/android/maven2/").get())
            content { includeGroupByRegex("com\\.android.*"); includeGroupByRegex("com\\.google.*"); includeGroupByRegex("androidx.*") }
        }
        mavenCentral()
    }
}
rootProject.name = "ISPMaxAndroid"
include(":app")
include(":device-companion")
project(":device-companion").projectDir = file("../device-studio/android-companion")
