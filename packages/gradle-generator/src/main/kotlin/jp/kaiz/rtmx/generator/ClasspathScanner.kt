package jp.kaiz.rtmx.generator

import java.io.File
import java.lang.module.ModuleFinder
import java.lang.reflect.Modifier
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.net.URLClassLoader
import java.util.jar.JarFile

data class JavaTypeParam(val name: String, val upperBounds: List<Type>)
data class JavaField(val name: String, val javaType: Type, val isStatic: Boolean)
data class JavaMethod(
    val name: String,
    val paramTypes: List<Type>,
    val returnType: Type,
    val isStatic: Boolean,
    val isVarArgs: Boolean
)
data class JavaConstructor(val paramTypes: List<Type>, val isVarArgs: Boolean)
data class JavaClass(
    val fqn: String,
    val typeParams: List<JavaTypeParam>,
    val superclass: Type?,
    val superInterfaces: List<Type>,
    val constructors: List<JavaConstructor>,
    val fields: List<JavaField>,
    val methods: List<JavaMethod>,
    val isInterface: Boolean = false,
    val isAbstract: Boolean = false
)

object ClasspathScanner {
    fun scan(
        classpathFiles: Iterable<File>,
        packagePrefixes: List<String>,
        srgToMcp: Map<String, String> = emptyMap()
    ): List<JavaClass> {
        val files = classpathFiles.filter { it.exists() }

        val classNames = mutableListOf<String>()
        for (file in files) {
            when {
                file.isDirectory -> file.walkTopDown()
                    .filter { it.name.endsWith(".class") && !it.name.contains('$') }
                    .forEach { f ->
                        val fqn = f.relativeTo(file).path
                            .removeSuffix(".class").replace(File.separatorChar, '.')
                        if (packagePrefixes.any { fqn.startsWith(it) }) classNames.add(fqn)
                    }

                file.name.endsWith(".jar") -> JarFile(file).use { jar ->
                    for (entry in jar.entries()) {
                        if (!entry.name.endsWith(".class")) continue
                        if (entry.name.contains('$')) continue
                        val fqn = entry.name.removeSuffix(".class").replace('/', '.')
                        if (packagePrefixes.any { fqn.startsWith(it) }) classNames.add(fqn)
                    }
                }
            }
        }

        val jdkPrefixes = packagePrefixes.filter { isJdkPackage(it) }
        if (jdkPrefixes.isNotEmpty()) {
            classNames.addAll(scanJdkPackages(jdkPrefixes))
        }

        val urls = files.map { it.toURI().toURL() }.toTypedArray()
        val classLoader = URLClassLoader(urls, ClassLoader.getPlatformClassLoader())

        val results = mutableListOf<JavaClass>()
        val skipped = mutableListOf<String>()
        for (fqn in classNames) {
            try {
                val cls = classLoader.loadClass(fqn)
                if (!Modifier.isPublic(cls.modifiers)) continue
                results.add(toJavaClass(cls, packagePrefixes, srgToMcp))
            } catch (e: Throwable) {
                skipped.add("$fqn: ${e::class.simpleName}: ${e.message?.substringBefore('\n')}")
            }
        }
        if (skipped.isNotEmpty()) {
            println("[ClasspathScanner] Skipped ${skipped.size} classes:")
            skipped.forEach { println("  $it") }
        }
        return results
    }

    private fun toJavaClass(
        cls: Class<*>,
        packagePrefixes: List<String>,
        srgToMcp: Map<String, String>
    ): JavaClass {
        fun getRawName(type: Type): String? = when (type) {
            is Class<*> -> type.name
            is ParameterizedType -> (type.rawType as? Class<*>)?.name
            else -> null
        }

        fun inScope(type: Type): Boolean {
            val name = getRawName(type) ?: return false
            return packagePrefixes.any { name.startsWith(it) } && !name.contains('$')
        }

        val typeParams = cls.typeParameters.map { tv ->
            JavaTypeParam(tv.name, tv.bounds.toList())
        }

        val superclass = cls.genericSuperclass
            ?.takeIf { it != java.lang.Object::class.java && inScope(it) }

        val superInterfaces = cls.genericInterfaces
            .filter { inScope(it) }
            .toList()

        val constructors = cls.constructors
            .mapNotNull { c ->
                runCatching {
                    JavaConstructor(c.genericParameterTypes.toList(), c.isVarArgs)
                }.getOrNull()
            }

        val fields = cls.declaredFields
            .filter { Modifier.isPublic(it.modifiers) }
            .mapNotNull { f ->
                runCatching {
                    JavaField(
                        srgToMcp[f.name] ?: f.name,
                        f.genericType,
                        Modifier.isStatic(f.modifiers)
                    )
                }.getOrNull()
            }

        val methods = cls.declaredMethods
            .filter { m ->
                Modifier.isPublic(m.modifiers) && m.name !in OBJECT_METHODS
            }
            .mapNotNull { m ->
                runCatching {
                    JavaMethod(
                        name = srgToMcp[m.name] ?: m.name,
                        paramTypes = m.genericParameterTypes.toList(),
                        returnType = m.genericReturnType,
                        isStatic = Modifier.isStatic(m.modifiers),
                        isVarArgs = m.isVarArgs
                    )
                }.getOrNull()
            }

        return JavaClass(
            cls.name,
            typeParams,
            superclass,
            superInterfaces,
            constructors,
            fields,
            methods,
            cls.isInterface,
            Modifier.isAbstract(cls.modifiers)
        )
    }

    private fun isJdkPackage(prefix: String) =
        prefix == "java" || prefix.startsWith("java.") ||
        prefix == "javax" || prefix.startsWith("javax.")

    private fun scanJdkPackages(prefixes: List<String>): List<String> {
        val names = mutableListOf<String>()
        for (ref in ModuleFinder.ofSystem().findAll()) {
            try {
                ref.open().use { reader ->
                    reader.list().toList()
                        .filter { it.endsWith(".class") && !it.contains('$') }
                        .map { it.removeSuffix(".class").replace('/', '.') }
                        .filter { fqn -> prefixes.any { fqn.startsWith(it) } }
                        .forEach { names.add(it) }
                }
            } catch (_: Exception) {
                // 読み取り不能なモジュールはスキップ
            }
        }
        return names
    }

    private val OBJECT_METHODS = setOf(
        "equals", "hashCode", "toString", "getClass",
        "wait", "notify", "notifyAll", "clone", "finalize"
    )
}
