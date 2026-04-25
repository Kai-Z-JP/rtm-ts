package jp.kaiz.rtmx.generator

import java.io.File
import java.lang.reflect.Modifier
import java.net.URLClassLoader
import java.util.jar.JarFile

data class JavaField(val name: String, val javaType: Class<*>, val isStatic: Boolean)
data class JavaMethod(
    val name: String,
    val paramTypes: List<Class<*>>,
    val returnType: Class<*>,
    val isStatic: Boolean,
    val isVarArgs: Boolean
)

data class JavaConstructor(val paramTypes: List<Class<*>>, val isVarArgs: Boolean)
data class JavaClass(
    val fqn: String,
    val superclass: String?,      // スコープ内の直接スーパークラス FQN、なければ null
    val superInterfaces: List<String>,  // スコープ内の実装インタフェース FQN
    val constructors: List<JavaConstructor>,
    val fields: List<JavaField>,
    val methods: List<JavaMethod>
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
        fun inScope(name: String) =
            packagePrefixes.any { name.startsWith(it) } && !name.contains('$')

        val superclass = cls.superclass
            ?.takeIf { it != Object::class.java && inScope(it.name) }
            ?.name

        val superInterfaces = cls.interfaces
            .filter { inScope(it.name) }
            .map { it.name }

        val constructors = cls.constructors
            .mapNotNull { c ->
                runCatching { JavaConstructor(c.parameterTypes.toList(), c.isVarArgs) }.getOrNull()
            }

        val fields = cls.declaredFields
            .filter { Modifier.isPublic(it.modifiers) }
            .mapNotNull { f ->
                runCatching {
                    JavaField(
                        srgToMcp[f.name] ?: f.name,
                        f.type,
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
                        paramTypes = m.parameterTypes.toList(),
                        returnType = m.returnType,
                        isStatic = Modifier.isStatic(m.modifiers),
                        isVarArgs = m.isVarArgs
                    )
                }.getOrNull()
            }

        return JavaClass(cls.name, superclass, superInterfaces, constructors, fields, methods)
    }

    private val OBJECT_METHODS = setOf(
        "equals", "hashCode", "toString", "getClass",
        "wait", "notify", "notifyAll", "clone", "finalize"
    )
}
