plugins {
    base
}

tasks.register<Exec>("pnpmInstall") {
    commandLine("pnpm", "install")
}

tasks.register<Exec>("buildRtmx") {
    dependsOn(":gradle-generator:installScannerJar")
    dependsOn("pnpmInstall")
    commandLine("pnpm", "--filter", "rtm-ts", "build")
}

tasks.register<Exec>("publishRtmx") {
    dependsOn("buildRtmx")
    commandLine("pnpm", "--filter", "rtm-ts", "publish")
}

tasks.register<Exec>("generateTypings") {
    dependsOn("buildRtmx")
    commandLine("pnpm", "gen")
    workingDir("sample")
}

tasks.register<Exec>("generateTypings1122") {
    dependsOn("buildRtmx")
    commandLine("pnpm", "gen")
    workingDir("sample-1.12.2")
}

tasks.register<Exec>("generateTypingsMultiTarget") {
    dependsOn("buildRtmx")
    commandLine("pnpm", "gen")
    workingDir("sample-multitarget")
}

tasks.register<Exec>("compileRtmScripts") {
    dependsOn("buildRtmx")
    commandLine("pnpm", "build")
    workingDir("sample")
}
