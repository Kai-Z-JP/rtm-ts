package jp.kaiz.rtmx.generator

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

class DtsEmitterTest {

    @TempDir
    lateinit var tempDir: File

    private val entityClass = JavaClass(
        fqn = "net.minecraft.entity.Entity",
        fields = listOf(
            JavaField("posX", "D", isStatic = false),
            JavaField("posY", "D", isStatic = false),
            JavaField("MAX_ENTITY_COUNT", "I", isStatic = true),
        ),
        methods = listOf(
            JavaMethod("getDistance", "(DDD)D", isStatic = false),
            JavaMethod("getEntityClass", "()Ljava/lang/Class;", isStatic = true),
        )
    )

    @Test
    fun `Entity から d_ts が生成される`() {
        DtsEmitter.emit(listOf(entityClass), tempDir)
        val files = tempDir.listFiles()!!
        assertEquals(1, files.size, "1 ファイル生成されること")

        val content = files[0].readText()
        assertTrue(content.contains("declare module \"net.minecraft.entity\""), "module 宣言")
        assertTrue(content.contains("export class Entity"), "class 宣言")
    }

    @Test
    fun `instance field は非 static として生成される`() {
        DtsEmitter.emit(listOf(entityClass), tempDir)
        val content = tempDir.listFiles()!![0].readText()
        assertTrue(content.contains("posX: number"), "posX フィールド")
        assertFalse(content.contains("static posX"), "posX は static でないこと")
    }

    @Test
    fun `static field は static として生成される`() {
        DtsEmitter.emit(listOf(entityClass), tempDir)
        val content = tempDir.listFiles()!![0].readText()
        assertTrue(content.contains("static MAX_ENTITY_COUNT: number"), "static フィールド")
    }

    @Test
    fun `static method は static として生成される`() {
        DtsEmitter.emit(listOf(entityClass), tempDir)
        val content = tempDir.listFiles()!![0].readText()
        assertTrue(content.contains("static getEntityClass"), "static メソッド")
    }

    @Test
    fun `package filter が効く`() {
        val other = JavaClass("com.example.Foo", emptyList(), emptyList())
        // net.minecraft のみフィルタして emit
        val filtered = listOf(entityClass, other)
            .filter { it.fqn.startsWith("net.minecraft") }
        DtsEmitter.emit(filtered, tempDir)
        val files = tempDir.listFiles()!!
        assertTrue(files.all { it.readText().contains("net.minecraft") })
        assertFalse(files.any { it.readText().contains("com.example") })
    }
}
