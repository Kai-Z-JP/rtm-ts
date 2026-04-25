# rtm-ts
TypeScript toolchain for [KaizParch/RTM (Real Train Mod)](https://github.com/Kai-Z-JP/KaizPatchX) / Minecraft 1.7.10 scripting.

RTM のスクリプト (Nashorn JS) を TypeScript で書けるようにします。Minecraft の Java クラスから自動で型定義 (`.d.ts`) を生成し、MCP → SRG のフィールド名変換も行います。

## Requirements

- Node.js >= 18
- Java >= 25 (型定義生成時)
- pnpm

## Quick Start

```sh
pnpx rtm-ts init my-modelpack
cd my-modelpack
pnpm install
# rtmx.json を編集して mods/packages を設定
pnpm gen    # 型定義・マッピング生成 (初回・依存変更時)
pnpm build  # TypeScript コンパイル
```

## Commands

| コマンド | 説明 |
|---------|------|
| `rtmx init [dir]` | プロジェクトをスキャフォールド |
| `rtmx generate` | 型定義・MCP マッピングを生成 |
| `rtmx build` | TypeScript をコンパイル |
| `rtmx zip` | `artifacts/<name>.zip` を生成 |

## Configuration (`rtmx.json`)

```jsonc
{
  "name": "my-modelpack",  // artifacts/<name>.zip のファイル名
  "srcDir": "src",         // TypeScript ソースディレクトリ
  "outDir": "dist",        // コンパイル出力先
  "scan": {
    "minecraftVersion": "1.7.10",
    "forgeVersion": "10.13.4.1614",
    "channel": "stable",       // MCP チャンネル (stable / snapshot)
    "mappingsVersion": "12",
    "mods": [
      // rfg.deobf() に渡す Maven 依存関係
      "com.github.Kai-Z-JP:KaizPatchX:v1.9.5"
    ],
    "packages": [
      // スキャン対象の Java パッケージ
      "net.minecraft",
      "net.minecraftforge",
      "cpw.mods",
      "jp.ngt",
      "org.lwjgl"
    ],
    "outputDir": "generated"   // 省略可 (デフォルト: generated/)
  },
  "compilerOptions": {
    "strict": true,
    "target": "ES5",
    "module": "none",
    "noEmitOnError": true,
    "skipLibCheck": true
  }
}
```

### Gradle で使う Java を指定する

`rtmx generate` が内部で呼ぶ Gradle に対して、システムの `JAVA_HOME` とは別の JDK を使わせたい場合は、`.npmrc` で `gradle-java-home` を指定します。

```ini
# .npmrc
gradle-java-home=/path/to/jdk25
```

コマンドラインから一時的に指定することもできます。

```sh
pnpm gen --gradle-java-home=/path/to/jdk25
```

設定されている場合、Gradle 実行時の `JAVA_HOME` がその値で上書きされます。未設定のときはシステムの `JAVA_HOME` / PATH が使われます。

### `typings` / `mapping` を手動指定する場合

`scan` を省略して既存の生成物を指定することもできます。

```jsonc
{
  "srcDir": "src",
  "outDir": "dist/scripts",
  "typings": ["generated/typings/*.d.ts"],
  "mapping": "generated/mappings/mcp-to-srg.json"
}
```

## Project Structure

```
my-modelpack/
├── src/               # TypeScript ソース
├── generated/         # rtmx generate が出力 (gitignore 推奨)
│   ├── typings/       # *.d.ts
│   └── mappings/      # mcp-to-srg.json
├── dist/scripts/      # rtmx build が出力
├── artifacts/         # rtmx zip が出力 (gitignore 推奨)
├── rtmx.json
├── tsconfig.json
└── package.json
```

## How It Works

```
rtmx generate
  │
  ├─ 内部 Gradle プロジェクトを ~/.rtmx/gradle/{hash}/ に展開
  ├─ ./gradlew exportRtmPaths
  │    Minecraft JAR / Forge / MCP mappings をダウンロード
  │
  └─ java -jar scanner.jar
       Java リフレクションでクラスをスキャン
       → generated/typings/*.d.ts
       → generated/mappings/mcp-to-srg.json

rtmx build
  TypeScript を Nashorn 互換 ES5 JS にコンパイル
  import 文を Java パッケージ参照に変換
  MCP フィールド名を SRG 名に変換

rtmx zip
  src/ と dist/ をマージしてルート展開 (.ts 除外)
  → artifacts/<name>.zip
```

## Documentation

- [Renderer スクリプトの特別仕様](docs/renderer.md)
- [ES5 JS → TypeScript 移行ガイド](docs/migration.md)

## License

MIT
