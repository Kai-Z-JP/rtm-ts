package jp.kaiz.rtmx.generator

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class MappingJsonEmitterTest {

    @TempDir
    lateinit var tempDir: File

    private val sampleMappings = RawMappings(
        fields = listOf(
            FieldEntry(
                srgName = "field_70165_t",
                mcpName = "posX",
                ownerSrg = "net.minecraft.entity.Entity"
            )
        ),
        methods = listOf(
            MethodEntry(
                srgName = "func_70011_f",
                mcpName = "getDistance",
                ownerSrg = "net.minecraft.entity.Entity",
                descriptor = "(DDD)D"
            )
        )
    )

    @Test
    fun `mapping JSON が生成される`() {
        val outFile = File(tempDir, "mcp-to-srg.json")
        MappingJsonEmitter.emit(sampleMappings, outFile)
        assertTrue(outFile.exists(), "ファイルが生成される")

        val content = outFile.readText()
        assertTrue(content.contains("\"net.minecraft.entity.Entity\""), "class FQN")
        assertTrue(content.contains("\"posX\""), "MCP field 名")
        assertTrue(content.contains("\"field_70165_t\""), "SRG field 名")
        assertTrue(content.contains("\"getDistance(DDD)D\""), "method key")
        assertTrue(content.contains("\"func_70011_f\""), "SRG method 名")
    }

    @Test
    fun `JSON が valid である`() {
        val outFile = File(tempDir, "mcp-to-srg.json")
        MappingJsonEmitter.emit(sampleMappings, outFile)
        val content = outFile.readText()
        // 基本的な JSON 構造チェック
        assertTrue(content.trimStart().startsWith("{"), "JSON オブジェクト")
        assertTrue(content.trimEnd().endsWith("}"), "JSON オブジェクト終端")
        assertTrue(content.contains("\"classes\""), "classes キー")
    }

    @Test
    fun `空の mapping でも生成できる`() {
        val outFile = File(tempDir, "empty.json")
        MappingJsonEmitter.emit(RawMappings(emptyList(), emptyList()), outFile)
        assertTrue(outFile.exists())
        assertTrue(outFile.readText().contains("\"classes\""))
    }
}
