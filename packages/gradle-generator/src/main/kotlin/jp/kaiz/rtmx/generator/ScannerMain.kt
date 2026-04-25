package jp.kaiz.rtmx.generator

import java.io.File

fun main(args: Array<String>) {
    val params = mutableMapOf<String, String>()
    var i = 0
    while (i < args.size - 1) {
        if (args[i].startsWith("--")) {
            params[args[i].removePrefix("--")] = args[i + 1]
            i += 2
        } else {
            i++
        }
    }

    val classpathFiles = params["classpath"]
        ?.split(File.pathSeparator)
        ?.map(::File)
        ?: error("--classpath is required")

    val packages = params["packages"]
        ?.split(",")
        ?: error("--packages is required")

    val typingsDir = params["typingsDir"]?.let(::File)
    val mappingsDir = params["mappingsDir"]?.let(::File)
    val srgToMcpFile = params["srgToMcpFile"]?.let(::File)
    val mcpToSrgFile = params["mcpToSrgFile"]?.let(::File)

    val srgToMcp = buildSrgToMcpMap(srgToMcpFile)

    println("[scanner] Scanning ${classpathFiles.count { it.exists() }} classpath entries...")
    val classes = ClasspathScanner.scan(classpathFiles, packages, srgToMcp)
    println("[scanner] Found ${classes.size} classes")

    if (typingsDir != null) {
        DtsEmitter.emit(classes, typingsDir)
        println("[scanner] Typings -> ${typingsDir.absolutePath}")
    }

    if (mappingsDir != null && mcpToSrgFile != null && mcpToSrgFile.exists()) {
        val mappings = SrgMappingReader().read(mcpToSrgFile)
        MappingJsonEmitter.emit(mappings, File(mappingsDir, "mcp-to-srg.json"))
        println("[scanner] Mappings -> ${mappingsDir.absolutePath}")
    }
    println("[scanner] Done!")
}

private fun buildSrgToMcpMap(file: File?): Map<String, String> {
    if (file == null || !file.exists()) return emptyMap()
    val map = mutableMapOf<String, String>()
    for (line in file.readLines()) {
        val parts = line.trim().split(" ")
        when {
            line.startsWith("FD:") && parts.size >= 3 ->
                map[parts[1].substringAfterLast('/')] = parts[2].substringAfterLast('/')
            line.startsWith("MD:") && parts.size >= 5 ->
                map[parts[1].substringAfterLast('/')] = parts[3].substringAfterLast('/')
        }
    }
    return map
}
