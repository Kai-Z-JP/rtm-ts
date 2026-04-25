plugins {
    base
}

tasks.register<Exec>("pnpmInstall") {
    commandLine("pnpm", "install")
}

tasks.register<Exec>("buildRtmx") {
    dependsOn(":gradle-generator:installScannerJar")
    dependsOn("pnpmInstall")
    commandLine("pnpm", "--filter", "rtmx", "build")
}

tasks.register<Exec>("publishRtmx") {
    dependsOn("buildRtmx")
    commandLine("pnpm", "--filter", "rtmx", "publish")
}

tasks.register<Exec>("generateTypings") {
    dependsOn("buildRtmx")
    commandLine("pnpm", "gen")
    workingDir("sample")
}

tasks.register<Exec>("compileRtmScripts") {
    dependsOn("buildRtmx")
    commandLine("pnpm", "build")
    workingDir("sample")
}
