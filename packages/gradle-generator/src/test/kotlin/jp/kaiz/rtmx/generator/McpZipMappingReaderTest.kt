package jp.kaiz.rtmx.generator

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class McpZipMappingReaderTest {

    @TempDir
    lateinit var tempDir: File

    private fun createMcpZip(fields: String, methods: String): File {
        val zip = File(tempDir, "mcp.zip")
        ZipOutputStream(zip.outputStream()).use { zos ->
            zos.putNextEntry(ZipEntry("fields.csv"))
            zos.write("searge,name,side,desc\n$fields".toByteArray())
            zos.closeEntry()
            zos.putNextEntry(ZipEntry("methods.csv"))
            zos.write("searge,name,side,desc\n$methods".toByteArray())
            zos.closeEntry()
        }
        return zip
    }

    private fun createSrg(content: String): File {
        val srg = File(tempDir, "joined.srg")
        srg.writeText(content)
        return srg
    }

    @Test
    fun `fields_csv と joined_srg から field mapping を生成する`() {
        val zip = createMcpZip(
            fields = "field_70165_t,posX,2,\n",
            methods = ""
        )
        val srg = createSrg(
            "FD: dn/at net/minecraft/entity/Entity/field_70165_t\n"
        )

        val mappings = McpZipMappingReader().read(zip, srg)

        assertEquals(1, mappings.fields.size)
        val f = mappings.fields[0]
        assertEquals("posX", f.mcpName)
        assertEquals("field_70165_t", f.srgName)
        assertEquals("net.minecraft.entity.Entity", f.ownerSrg)
    }

    @Test
    fun `methods_csv と joined_srg から method mapping を生成する`() {
        val zip = createMcpZip(
            fields = "",
            methods = "func_70011_f,getDistance,2,\n"
        )
        val srg = createSrg(
            "MD: dn/a (DDD)D net/minecraft/entity/Entity/func_70011_f (DDD)D\n"
        )

        val mappings = McpZipMappingReader().read(zip, srg)

        assertEquals(1, mappings.methods.size)
        val m = mappings.methods[0]
        assertEquals("getDistance", m.mcpName)
        assertEquals("func_70011_f", m.srgName)
        assertEquals("net.minecraft.entity.Entity", m.ownerSrg)
        assertEquals("(DDD)D", m.descriptor)
    }

    @Test
    fun `SRG に存在しない CSV エントリはスキップする`() {
        val zip = createMcpZip(
            fields = "field_99999_x,unknownField,2,\n",
            methods = ""
        )
        val srg = createSrg("")

        val mappings = McpZipMappingReader().read(zip, srg)
        assertEquals(0, mappings.fields.size)
    }
}
