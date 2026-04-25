package jp.kaiz.rtmx.generator

import java.io.File

interface MappingReader {
    fun read(file: File): RawMappings
}

data class RawMappings(
    val fields: List<FieldEntry>,
    val methods: List<MethodEntry>
)

data class FieldEntry(val srgName: String, val mcpName: String, val ownerSrg: String)
data class MethodEntry(val srgName: String, val mcpName: String, val ownerSrg: String, val descriptor: String)

/** joined.srg 形式のリーダー */
class SrgMappingReader : MappingReader {
    override fun read(file: File): RawMappings {
        val fields = mutableListOf<FieldEntry>()
        val methods = mutableListOf<MethodEntry>()

        for (line in file.readLines()) {
            val parts = line.trim().split(" ")
            when {
                line.startsWith("FD:") && parts.size >= 3 -> {
                    val srg = parts[2].substringAfterLast('/')
                    val mcp = parts[1].substringAfterLast('/')
                    val owner = parts[1].substringBeforeLast('/').replace('/', '.')
                    fields.add(FieldEntry(srg, mcp, owner))
                }
                line.startsWith("MD:") && parts.size >= 5 -> {
                    val srg = parts[3].substringAfterLast('/')
                    val mcp = parts[1].substringAfterLast('/')
                    val owner = parts[1].substringBeforeLast('/').replace('/', '.')
                    val desc = parts[4]
                    methods.add(MethodEntry(srg, mcp, owner, desc))
                }
            }
        }

        return RawMappings(fields, methods)
    }
}
