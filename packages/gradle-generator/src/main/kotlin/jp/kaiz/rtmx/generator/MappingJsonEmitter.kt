package jp.kaiz.rtmx.generator

import java.io.File

object MappingJsonEmitter {
    fun emit(mappings: RawMappings, outputFile: File) {
        outputFile.parentFile.mkdirs()

        val classMap = mutableMapOf<String, ClassEntry>()

        for (f in mappings.fields) {
            val entry = classMap.getOrPut(f.ownerSrg) {
                ClassEntry(srg = f.ownerSrg)
            }
            entry.fields[f.mcpName] = FieldJson(f.srgName, null)
        }

        for (m in mappings.methods) {
            val entry = classMap.getOrPut(m.ownerSrg) {
                ClassEntry(srg = m.ownerSrg)
            }
            val key = "${m.mcpName}${m.descriptor}"
            entry.methods[key] = MethodJson(m.srgName)
        }

        val sb = StringBuilder()
        sb.appendLine("{")
        sb.appendLine("  \"classes\": {")
        classMap.entries.forEachIndexed { ci, (fqn, cls) ->
            val comma = if (ci < classMap.size - 1) "," else ""
            sb.appendLine("    \"$fqn\": {")
            sb.appendLine("      \"srg\": \"${cls.srg}\",")
            sb.appendLine("      \"fields\": {")
            cls.fields.entries.forEachIndexed { fi, (mcp, fj) ->
                val fc = if (fi < cls.fields.size - 1) "," else ""
                val descPart = if (fj.desc != null) ", \"desc\": \"${fj.desc}\"" else ""
                sb.appendLine("        \"$mcp\": { \"srg\": \"${fj.srg}\"$descPart }$fc")
            }
            sb.appendLine("      },")
            sb.appendLine("      \"methods\": {")
            cls.methods.entries.forEachIndexed { mi, (key, mj) ->
                val mc = if (mi < cls.methods.size - 1) "," else ""
                sb.appendLine("        \"$key\": { \"srg\": \"${mj.srg}\" }$mc")
            }
            sb.appendLine("      }")
            sb.appendLine("    }$comma")
        }
        sb.appendLine("  }")
        sb.append("}")

        outputFile.writeText(sb.toString())
    }

    private data class ClassEntry(
        val srg: String,
        val fields: MutableMap<String, FieldJson> = mutableMapOf(),
        val methods: MutableMap<String, MethodJson> = mutableMapOf()
    )
    private data class FieldJson(val srg: String, val desc: String?)
    private data class MethodJson(val srg: String)
}
