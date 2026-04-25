package jp.kaiz.rtmx.generator

import java.io.File
import java.util.zip.ZipFile

/**
 * MCP CSV 形式 + joined.srg から RawMappings を生成する。
 *
 * mcpZip: de.oceanlabs.mcp:mcp_stable:12@zip
 *   - fields.csv: searge(SRG名),name(MCP名),side,desc
 *   - methods.csv: searge(SRG名),name(MCP名),side,desc
 *
 * srgFile: joined.srg (notch → SRG)
 *   - FD: notchOwner/notchField srgOwner/srgField
 *   - MD: notchOwner/notchMethod notchDesc srgOwner/srgMethod srgDesc
 *
 * 出力: MCP名 → SRG名 の RawMappings (ownerSrg はドット区切り FQN)
 */
class McpZipMappingReader : MappingReader {
    fun read(mcpZip: File, srgFile: File): RawMappings {
        val srgFieldOwner = mutableMapOf<String, String>()   // srgFieldName → ownerFqn
        val srgMethodOwner = mutableMapOf<String, Pair<String, String>>() // srgMethodName → (ownerFqn, descriptor)

        for (line in srgFile.readLines()) {
            val parts = line.trim().split(" ")
            when {
                line.startsWith("FD:") && parts.size >= 3 -> {
                    val srgPath = parts[2]
                    val srgName = srgPath.substringAfterLast('/')
                    val owner = srgPath.substringBeforeLast('/').replace('/', '.')
                    srgFieldOwner[srgName] = owner
                }
                line.startsWith("MD:") && parts.size >= 5 -> {
                    val srgPath = parts[3]
                    val srgName = srgPath.substringAfterLast('/')
                    val owner = srgPath.substringBeforeLast('/').replace('/', '.')
                    val descriptor = parts[4]
                    srgMethodOwner[srgName] = Pair(owner, descriptor)
                }
            }
        }

        val srgToMcpField = mutableMapOf<String, String>()
        val srgToMcpMethod = mutableMapOf<String, String>()

        ZipFile(mcpZip).use { zip ->
            zip.getEntry("fields.csv")?.let { entry ->
                zip.getInputStream(entry).bufferedReader().useLines { lines ->
                    lines.drop(1).forEach { line ->
                        val cols = line.split(",")
                        if (cols.size >= 2) srgToMcpField[cols[0]] = cols[1]
                    }
                }
            }
            zip.getEntry("methods.csv")?.let { entry ->
                zip.getInputStream(entry).bufferedReader().useLines { lines ->
                    lines.drop(1).forEach { line ->
                        val cols = line.split(",")
                        if (cols.size >= 2) srgToMcpMethod[cols[0]] = cols[1]
                    }
                }
            }
        }

        val fields = mutableListOf<FieldEntry>()
        val methods = mutableListOf<MethodEntry>()

        for ((srgName, mcpName) in srgToMcpField) {
            val owner = srgFieldOwner[srgName] ?: continue
            fields.add(FieldEntry(srgName = srgName, mcpName = mcpName, ownerSrg = owner))
        }

        for ((srgName, mcpName) in srgToMcpMethod) {
            val (owner, descriptor) = srgMethodOwner[srgName] ?: continue
            methods.add(MethodEntry(
                srgName = srgName,
                mcpName = mcpName,
                ownerSrg = owner,
                descriptor = descriptor
            ))
        }

        return RawMappings(fields, methods)
    }

    override fun read(file: File): RawMappings {
        throw UnsupportedOperationException("Use read(mcpZip, srgFile) instead")
    }
}
