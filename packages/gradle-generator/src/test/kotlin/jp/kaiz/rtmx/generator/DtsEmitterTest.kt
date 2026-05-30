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
        val files = tempDir.listFiles()!!.filter { it.name != "rtmx.d.ts" }
        assertEquals(1, files.size, "package ごとの d.ts が 1 ファイル生成されること")

        val content = files[0].readText()
        assertTrue(content.contains("declare namespace net.minecraft.entity"), "namespace 宣言")
        assertTrue(content.contains("declare module \"net.minecraft.entity\""), "module 宣言")
        assertTrue(content.contains("export import Entity"), "Entity の re-export")
    }

    @Test
    fun `instance field は非 static として生成される`() {
        DtsEmitter.emit(listOf(entityClass), tempDir)
        val content = tempDir.resolve("net_minecraft_entity.d.ts").readText()
        assertTrue(content.contains("posX: number"), "posX フィールド")
        assertFalse(content.contains("static posX"), "posX は static でないこと")
    }

    @Test
    fun `static field は static として生成される`() {
        DtsEmitter.emit(listOf(entityClass), tempDir)
        val content = tempDir.resolve("net_minecraft_entity.d.ts").readText()
        assertTrue(content.contains("static MAX_ENTITY_COUNT: number"), "static フィールド")
    }

    @Test
    fun `static method は static として生成される`() {
        DtsEmitter.emit(listOf(entityClass), tempDir)
        val content = tempDir.resolve("net_minecraft_entity.d.ts").readText()
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
        val files = tempDir.listFiles()!!.filter { it.name != "rtmx.d.ts" }
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
        val content = tempDir.resolve("java_util.d.ts").readText()
        assertTrue(content.contains("class ArrayList<E"), "型パラメータ E が出力されること")
    }

    @Test
    fun `Java 配列は専用の Java 配列型として出力される`() {
        val arrayHolderClass = JavaClass(
            fqn = "com.example.ArrayHolder",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = listOf(
                JavaField("ids", IntArray::class.java, isStatic = false),
                JavaField("names", Array<String>::class.java, isStatic = false),
            ),
            methods = listOf(
                JavaMethod(
                    name = "getMatrix",
                    paramTypes = emptyList(),
                    returnType = Array<IntArray>::class.java,
                    isStatic = false,
                    isVarArgs = false
                )
            )
        )

        DtsEmitter.emit(listOf(arrayHolderClass), tempDir)
        val helperContent = tempDir.resolve("rtmx.d.ts").readText()
        val content = tempDir.resolve("com_example.d.ts").readText()

        assertTrue(helperContent.contains("interface JavaIntArray extends JavaArrayLike<number> {}"), "JavaIntArray が宣言されること")
        assertFalse(content.contains("declare namespace rtmx"), "各 package の d.ts には rtmx namespace を重複出力しないこと")
        assertTrue(content.contains("ids: JavaIntArray;"), "int[] は JavaIntArray として出力されること")
        assertTrue(content.contains("names: JavaObjectArray<string>;"), "String[] は JavaObjectArray<string> として出力されること")
        assertTrue(
            content.contains("getMatrix(): JavaObjectArray<JavaIntArray>;"),
            "int[][] は JavaObjectArray<JavaIntArray> として出力されること"
        )
    }

    @Test
    fun `NativeJava グローバル型が出力される`() {
        DtsEmitter.emit(emptyList(), tempDir)
        val helperContent = tempDir.resolve("rtmx.d.ts").readText()

        assertTrue(helperContent.contains("interface JavaType<T = any>"), "JavaType が宣言されること")
        assertTrue(helperContent.contains("interface NativeJava"), "NativeJava が宣言されること")
        assertTrue(helperContent.contains("isType(value: any): value is JavaType<any>;"), "Java.isType が宣言されること")
        assertTrue(helperContent.contains("synchronized<T extends (...args: any[]) => any>(func: T, lock: any): T;"), "Java.synchronized が宣言されること")
        assertTrue(helperContent.contains("isJavaMethod(value: any): boolean;"), "Java.isJavaMethod が宣言されること")
        assertTrue(helperContent.contains("isJavaFunction(value: any): boolean;"), "Java.isJavaFunction が宣言されること")
        assertTrue(helperContent.contains("isJavaObject(value: any): boolean;"), "Java.isJavaObject が宣言されること")
        assertTrue(helperContent.contains("isScriptObject(value: any): boolean;"), "Java.isScriptObject が宣言されること")
        assertTrue(helperContent.contains("isScriptFunction(value: any): boolean;"), "Java.isScriptFunction が宣言されること")
        assertTrue(helperContent.contains("type<T = any>(className: string): JavaType<T>;"), "Java.type が宣言されること")
        assertTrue(helperContent.contains("typeName(value: any): string | undefined;"), "Java.typeName が宣言されること")
        assertTrue(helperContent.contains("to(value: null, type?: string | JavaType<any>): null;"), "Java.to の省略可能な型引数が宣言されること")
        assertTrue(helperContent.contains("to<T>(value: ArrayLike<T>): JavaObjectArray<T>;"), "Java.to の配列変換が宣言されること")
        assertTrue(helperContent.contains("to(value: object): JavaObjectArray<any>;"), "Java.to のオブジェクト変換が宣言されること")
        assertTrue(helperContent.contains("to<T, R = any>(value: ArrayLike<T>, type: string | JavaType<R>): R;"), "Java.to の型付き配列変換が宣言されること")
        assertTrue(helperContent.contains("to<R = any>(value: object, type: string | JavaType<R>): R;"), "Java.to の型付きオブジェクト変換が宣言されること")
        assertTrue(helperContent.contains("from(array: null): null;"), "Java.from の null overload が宣言されること")
        assertTrue(helperContent.contains("from<T>(array: JavaArrayLike<T>): T[];"), "Java.from が宣言されること")
        assertTrue(helperContent.contains("from<T = any>(array: any): T[];"), "Java.from の動的 overload が宣言されること")
        assertTrue(helperContent.contains("extend<T = any>(type: JavaType<T>, ...typesOrImplementation: any[])"), "Java.extend が宣言されること")
        assertTrue(helperContent.contains("super<T>(instance: T): T;"), "Java.super が宣言されること")
        assertTrue(helperContent.contains("asJSONCompatible(value: any): any;"), "Java.asJSONCompatible が宣言されること")
        assertTrue(helperContent.contains("declare const Java: NativeJava;"), "Java グローバルが宣言されること")
    }

    @Test
    fun `Java varargs は呼び出し用の rest parameter として出力される`() {
        val logClass = JavaClass(
            fqn = "cpw.mods.fml.common.FMLLog",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = emptyList(),
            methods = listOf(
                JavaMethod(
                    name = "info",
                    paramTypes = listOf(String::class.java, Array<Any>::class.java),
                    returnType = java.lang.Void.TYPE,
                    isStatic = true,
                    isVarArgs = true
                )
            )
        )

        DtsEmitter.emit(listOf(logClass), tempDir)
        val content = tempDir.resolve("cpw_mods_fml_common.d.ts").readText()

        assertTrue(content.contains("static info(p0: string, ...p1: any[]): void;"), "varargs は TS rest parameter として出力されること")
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
        val content = tempDir.resolve("net_minecraft_command.d.ts").readText()
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
        val content = tempDir.resolve("net_minecraft_entity_player.d.ts").readText()
        assertTrue(content.contains("abstract class EntityPlayer {"), "abstract class として出力されること")
    }

    @Test
    fun `superclass の method を上書きする場合は override modifier を出力する`() {
        val baseClass = JavaClass(
            fqn = "java.lang.RuntimeException",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = emptyList(),
            methods = listOf(
                JavaMethod(
                    name = "getMessage",
                    paramTypes = emptyList(),
                    returnType = String::class.java,
                    isStatic = false,
                    isVarArgs = false
                )
            )
        )
        val vehicleClass = JavaClass(
            fqn = "jp.ngt.rtm.entity.vehicle.EntityVehicleBase",
            typeParams = emptyList(),
            superclass = RuntimeException::class.java,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = emptyList(),
            methods = listOf(
                JavaMethod(
                    name = "getMessage",
                    paramTypes = emptyList(),
                    returnType = String::class.java,
                    isStatic = false,
                    isVarArgs = false
                ),
                JavaMethod(
                    name = "getSpeed",
                    paramTypes = emptyList(),
                    returnType = java.lang.Double.TYPE,
                    isStatic = false,
                    isVarArgs = false
                )
            )
        )

        DtsEmitter.emit(listOf(baseClass, vehicleClass), tempDir)
        val content = tempDir.resolve("jp_ngt_rtm_entity_vehicle.d.ts").readText()
        assertTrue(content.contains("override getMessage(): string;"), "override method に modifier が付くこと")
        assertTrue(content.contains("getSpeed(): number;"), "通常 method は出力されること")
        assertFalse(content.contains("override getSpeed"), "override でない method には modifier を付けないこと")
    }

    @Test
    fun `内部 Enum は namespace merge として生成される`() {
        // Connection$ConnectionType に相当する内部 Enum
        val innerEnumClass = JavaClass(
            fqn = "jp.ngt.rtm.electric.Connection\$ConnectionType",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = listOf(
                JavaField("WIRE", java.lang.Object::class.java, isStatic = true),
            ),
            methods = emptyList(),
            enclosingFqn = "jp.ngt.rtm.electric.Connection"
        )

        // Connection 本体
        val connectionClass = JavaClass(
            fqn = "jp.ngt.rtm.electric.Connection",
            typeParams = emptyList(),
            superclass = null,
            superInterfaces = emptyList(),
            constructors = emptyList(),
            fields = listOf(
                JavaField("type", java.lang.Object::class.java, isStatic = false),
            ),
            methods = emptyList(),
            enclosingFqn = null
        )

        DtsEmitter.emit(listOf(connectionClass, innerEnumClass), tempDir)
        val content = tempDir.resolve("jp_ngt_rtm_electric.d.ts").readText()

        assertTrue(content.contains("namespace Connection {"), "Connection の namespace merge が出力されること")
        assertTrue(content.contains("class ConnectionType"), "ConnectionType class が出力されること")
        assertFalse(content.contains("Connection\$ConnectionType"), "バイナリ名の \$ が出力されないこと")
    }
}
