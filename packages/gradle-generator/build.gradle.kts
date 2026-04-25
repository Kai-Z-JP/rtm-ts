plugins {
    `kotlin-dsl`
}

kotlin {
    jvmToolchain(21)
}

group = "jp.kaiz.rtmx"
version = "0.1.0"

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

// Standalone fat JAR bundling compiled classes + kotlin-stdlib
tasks.register<Jar>("scannerJar") {
    archiveFileName.set("rtm-scanner.jar")
    manifest {
        attributes["Main-Class"] = "jp.kaiz.rtmx.generator.ScannerMainKt"
    }
    from(sourceSets.main.get().output)
    from({
        // Bundle kotlin-stdlib (available via kotlin-dsl's compileClasspath)
        configurations.compileClasspath.get()
            .filter { it.name.startsWith("kotlin-stdlib") }
            .map { zipTree(it) }
    })
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
}

// Copy built JAR into rtmx package
tasks.register<Copy>("installScannerJar") {
    dependsOn("scannerJar")
    from(tasks.named("scannerJar"))
    into(file("${projectDir}/../rtmx/jars"))
    rename { "scanner.jar" }
}
