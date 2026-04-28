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
        typeParams = emptyList(),
        superclass = null,
        superInterfaces = emptyList(),
        constructors = emptyList(),
        fields = listOf(
            JavaField("posX", java.lang.Double.TYPE, isStatic = false),
            JavaField("posY", java.lang.Double.TYPE, isStatic = false),
            JavaField("MAX_ENTITY_COUNT", java.lang.Integer.TYPE, isStatic = true),
        ),
        methods = listOf(
            JavaMethod(
                name = "getDistance",
                paramTypes = listOf(java.lang.Double.TYPE, java.lang.Double.TYPE, java.lang.Double.TYPE),
                returnType = java.lang.Double.TYPE,
                isStatic = false,
                isVarArgs = false
            ),
            JavaMethod(
                name = "getEntityClass",
                paramTypes = emptyList(),
                returnType = java.lang.Class::class.java,
                isStatic = true,
                isVarArgs = false
            ),
        )
    )

    @Test
    fun `Entity から d_ts が生成される`() {
        DtsEmitter.emit(listOf(entityClass), tempDir)
        val files = tempDir.listFiles()!!
        assertEquals(1, files.size, "1 ファイル生成されること")

        val content = files[0].readText()
        assertTrue(content.contains("declare namespace net.minecraft.entity"), "namespace 宣言")
        assertTrue(content.contains("declare module \"net.minecraft.entity\""), "module 宣言")
        assertTrue(content.contains("export import Entity"), "Entity の re-export")
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
        val other = JavaClass(
            fqn = "com.example.Foo",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = emptyList(),
            methods = emptyList()
        )
        val filtered = listOf(entityClass, other)
            .filter { it.fqn.startsWith("net.minecraft") }
        DtsEmitter.emit(filtered, tempDir)
        val files = tempDir.listFiles()!!
        assertTrue(files.all { it.readText().contains("net.minecraft") })
        assertFalse(files.any { it.readText().contains("com.example") })
    }

    @Test
    fun `ジェネリクスが型パラメータ付きで出力される`() {
        val listClass = JavaClass(
            fqn = "java.util.ArrayList",
            typeParams = listOf(JavaTypeParam("E", listOf(java.lang.Object::class.java))),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = emptyList(),
            methods = listOf(
                JavaMethod(
                    name = "get",
                    paramTypes = listOf(java.lang.Integer.TYPE),
                    returnType = ArrayList::class.java.typeParameters[0], // TypeVariable E
                    isStatic = false,
                    isVarArgs = false
                )
            )
        )
        DtsEmitter.emit(listOf(listClass), tempDir)
        val content = tempDir.listFiles()!![0].readText()
        assertTrue(content.contains("class ArrayList<E"), "型パラメータ E が出力されること")
    }

    @Test
    fun `Java interface は TypeScript interface として生成される`() {
        val senderInterface = JavaClass(
            fqn = "net.minecraft.command.ICommandSender",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = emptyList(),
            methods = listOf(
                JavaMethod(
                    name = "getCommandSenderName",
                    paramTypes = emptyList(),
                    returnType = String::class.java,
                    isStatic = false,
                    isVarArgs = false
                )
            ),
            isInterface = true
        )

        DtsEmitter.emit(listOf(senderInterface), tempDir)
        val content = tempDir.listFiles()!![0].readText()
        assertTrue(content.contains("interface ICommandSender"), "TS interface として出力されること")
        assertFalse(content.contains("class ICommandSender"), "Java interface を class として出力しないこと")
    }

    @Test
    fun `Java abstract class の未実装 interface メソッドは abstract メソッドとして反映される`() {
        val runnableInterface = JavaClass(
            fqn = "java.lang.Runnable",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = emptyList(),
            methods = listOf(
                JavaMethod(
                    name = "run",
                    paramTypes = emptyList(),
                    returnType = java.lang.Void.TYPE,
                    isStatic = false,
                    isVarArgs = false
                )
            ),
            isInterface = true
        )
        val playerClass = JavaClass(
            fqn = "net.minecraft.entity.player.EntityPlayer",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = listOf(Runnable::class.java),
            constructors = emptyList(),
            fields = emptyList(),
            methods = emptyList(),
            isAbstract = true
        )

        DtsEmitter.emit(listOf(runnableInterface, playerClass), tempDir)
        val content = tempDir.resolve("net_minecraft_entity_player.d.ts").readText()
        assertTrue(
            content.contains("abstract class EntityPlayer implements java.lang.Runnable {"),
            "abstract class の implements として出力されること"
        )
        assertFalse(content.contains("interface EntityPlayer"), "存在しない EntityPlayer interface を出力しないこと")
        assertTrue(content.contains("abstract run(): void;"), "未実装 interface メソッドを abstract メソッドとして出力すること")
    }

    @Test
    fun `Java abstract class は TypeScript abstract class として生成される`() {
        val abstractPlayerClass = JavaClass(
            fqn = "net.minecraft.entity.player.EntityPlayer",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = emptyList(),
            methods = emptyList(),
            isAbstract = true
        )

        DtsEmitter.emit(listOf(abstractPlayerClass), tempDir)
        val content = tempDir.listFiles()!![0].readText()
        assertTrue(content.contains("abstract class EntityPlayer {"), "abstract class として出力されること")
    }
}
