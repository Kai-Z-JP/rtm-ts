# Multi-target 構成

1つの modelpack を複数の Minecraft / RTM 環境で動かすための構成です。

例えば次のような差分を、同じ TypeScript プロジェクトの中で扱えます。

- Minecraft 1.7.10 と 1.12.2 で Java API が違う
- KaizPatch と通常 RTM で使えるクラスやメソッドが違う
- 同じ MCP 名でも target ごとに SRG 名が違う

rtmx の multi-target は、コードを次の2種類に分けます。

| 種類   | 置き場所       | 役割                                 |
| ------ | -------------- | ------------------------------------ |
| common | `src/common`   | target 間で共有する RTM entry script |
| compat | `src/<target>` | Minecraft / RTM の差分を吸収する実装 |

common から Minecraft / RTM のバージョン固有 API を直接使った際に target 差分で壊れるのを防ぐため、差分がある処理は `@target/*` の compat module に逃がします。

## ディレクトリ構成

`sample-multitarget` は次のような構成です。

```text
sample-multitarget/
├── src/
│   ├── common/
│   │   └── assets/minecraft/scripts/
│   │       ├── render_editor.ts
│   │       ├── server_editor.ts
│   │       └── lib/
│   │           └── RTMApiCompat.compat.d.ts
│   ├── kaizpatch/
│   │   └── assets/minecraft/scripts/lib/
│   │       └── RTMApiCompat.compat.ts
│   ├── mc1710/
│   │   └── assets/minecraft/scripts/lib/
│   │       └── RTMApiCompat.compat.ts
│   └── mc1122/
│       └── assets/minecraft/scripts/lib/
│           └── RTMApiCompat.compat.ts
├── rtmx.json
├── tsconfig.common.json
├── tsconfig.kaizpatch.json
├── tsconfig.mc1710.json
└── tsconfig.mc1122.json
```

`src/common` には RTM が実際に呼ぶ entry script を置きます。

```typescript
import { RTMApiCompat } from "@target/assets/minecraft/scripts/lib/RTMApiCompat";
import { EntityVehicle } from "jp.ngt.rtm.entity.vehicle";

function render(entity: EntityVehicle, pass: number, par3: number): void {
  if (pass !== 0) return;

  const rider = RTMApiCompat.getRider(entity);
  if (rider) {
    RTMApiCompat.debug("rider id=" + RTMApiCompat.getEntityId(rider));
  }
}
```

`@target/*` は、common から見た「target ごとに実装が違う module」です。
common 側には実装を書かず、型だけを `*.compat.d.ts` として置きます。

```typescript
// src/common/assets/minecraft/scripts/lib/RTMApiCompat.compat.d.ts
import { Entity } from "net.minecraft.entity";

export declare class RTMApiCompat {
  static targetName(): string;
  static debug(message: string): void;
  static getRider(entity: Entity): Entity | null;
  static getEntityId(entity: Entity): number;
}
```

各 target 側には同じ module の実装を `*.compat.ts` として置きます。

```typescript
// src/mc1710/assets/minecraft/scripts/lib/RTMApiCompat.compat.ts
import { NGTLog } from "jp.ngt.ngtlib.io";
import { Entity } from "net.minecraft.entity";

export class RTMApiCompat {
  static targetName(): string {
    return "mc1710";
  }

  static debug(message: string): void {
    NGTLog.debug("[mc1710] " + message);
  }

  static getRider(entity: Entity): Entity | null {
    return entity.riddenByEntity ?? null;
  }

  static getEntityId(entity: Entity): number {
    return entity.getEntityId() ?? 0;
  }
}
```

1.12.2 では同じ API を別の呼び方にできます。

```typescript
// src/mc1122/assets/minecraft/scripts/lib/RTMApiCompat.compat.ts
import { NGTLog } from "jp.ngt.ngtlib.io";
import { Entity } from "net.minecraft.entity";

export class RTMApiCompat {
  static targetName(): string {
    return "mc1122";
  }

  static debug(message: string): void {
    NGTLog.debug("[mc1122] " + message);
  }

  static getRider(entity: Entity): Entity | null {
    return entity.getControllingPassenger() ?? null;
  }

  static getEntityId(entity: Entity): number {
    return entity.getEntityId() ?? 0;
  }
}
```

## rtmx.json

multi-target では、トップレベルに `targets` を書きます。

```jsonc
{
  "name": "sample-multitarget",
  "outDir": "dist",
  "commonApiPolicy": "allow",
  "targets": {
    "kaizpatch": {
      "compatFallbackTarget": "mc1710",
      "runtimeDispatch": "Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('KaizPatch') !== -1",
      "srcDirs": ["src/common", "src/kaizpatch"],
      "outDir": "dist/assets/minecraft/__targets__/kaizpatch",
      "scan": {
        "minecraftVersion": "1.7.10",
        "forgeVersion": "10.13.4.1614",
        "mappingsVersion": "12",
        "mods": ["com.github.Kai-Z-JP:KaizPatchX:v1.9.5"],
        "packages": ["net.minecraft", "net.minecraftforge", "cpw.mods", "jp.ngt", "org.lwjgl"],
      },
    },
    "mc1710": {
      "runtimeDispatch": "Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('1.7.10') >= 0",
      "srcDirs": ["src/common", "src/mc1710"],
      "outDir": "dist/assets/minecraft/__targets__/mc1710",
      "scan": {
        "minecraftVersion": "1.7.10",
        "forgeVersion": "10.13.4.1614",
        "mappingsVersion": "12",
        "mods": ["curse.maven:ngtlib-288989:6505474", "curse.maven:realtrainmod-288988:6505479"],
        "packages": ["net.minecraft", "net.minecraftforge", "cpw.mods", "jp.ngt", "org.lwjgl"],
      },
    },
    "mc1122": {
      "runtimeDispatch": "true",
      "srcDirs": ["src/common", "src/mc1122"],
      "outDir": "dist/assets/minecraft/__targets__/mc1122",
      "scan": {
        "minecraftVersion": "1.12.2",
        "forgeVersion": "14.23.5.2860",
        "mappingsVersion": "39",
        "mods": ["curse.maven:ngtlib-288989:4641592", "curse.maven:realtrainmod-288988:4641603"],
        "packages": ["net.minecraft", "net.minecraftforge", "jp.ngt", "org.lwjgl"],
      },
    },
  },
}
```

### `srcDirs`

`srcDirs` は必ず common を先、target 固有ディレクトリを後にします。

```json
"srcDirs": ["src/common", "src/mc1710"]
```

この順序には意味があります。

- `src/common` は共有 entry script と `*.compat.d.ts` を持つ
- `src/<target>` は `*.compat.ts` の実装を持つ
- `@target/*` は target 側では `src/<target>`、common 側では `src/common/*.compat.d.ts` を見る
- `@common/*` は target 側から common module を参照するときに使う

### `runtimeDispatch`

`runtimeDispatch` は、実行時にどの target 実装を使うかを選ぶ条件です。

```json
"runtimeDispatch": "Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf('1.7.10') >= 0"
```

rtmx は `targets` の順番で `if / else if / else` を生成します。
最後の target には `true` を置くと、明示的な fallback として読みやすくなります。

```json
"mc1122": {
  "runtimeDispatch": "true"
}
```

### `compatFallbackTarget`

`compatFallbackTarget` を指定すると、その target の `*.compat.ts` は差分だけを実装できます。
未実装の compat module / export / class static method は、指定した fallback target の実装で埋められます。

```json
"kaizpatch": {
  "compatFallbackTarget": "mc1710"
}
```

例えば KaizPatch が 1.7.10 RTM とほぼ同じなら、`src/kaizpatch` 側には KaizPatch 固有の `targetName()` や `debug()` だけを書き、乗車 API などは `mc1710` の compat 実装へ fallback できます。
build 時には、fallback がある target は partial 実装として型チェックされます。
fallback 先 target 自体は通常どおり `*.compat.d.ts` 全体を満たす必要があります。

## 生成物

`pnpm build` すると、common entry script は1回だけ出力されます。

```text
dist/assets/minecraft/scripts/render_editor.js
dist/assets/minecraft/scripts/server_editor.js
```

target ごとの出力には、compat 実装だけが入ります。

```text
dist/assets/minecraft/__targets__/kaizpatch/scripts/lib/RTMApiCompat.compat.js
dist/assets/minecraft/__targets__/mc1710/scripts/lib/RTMApiCompat.compat.js
dist/assets/minecraft/__targets__/mc1122/scripts/lib/RTMApiCompat.compat.js
```

common 側には、target を選ぶ selector が生成されます。

```text
dist/assets/minecraft/scripts/lib/RTMApiCompat.compat.js
```

selector は target 実装を include し、script の評価時に一度だけ実装を選びます。
`compatFallbackTarget` がある target では、selector が fallback target の実装を merge します。

```javascript
var RTMX_COMPAT_TARGETS = RTMX_COMPAT_TARGETS || {};
//include <__targets__/kaizpatch/scripts/lib/RTMApiCompat.compat.js>
//include <__targets__/mc1710/scripts/lib/RTMApiCompat.compat.js>
//include <__targets__/mc1122/scripts/lib/RTMApiCompat.compat.js>

function RTMX_selectCompatTarget_scripts_lib_RTMApiCompat_182qpdt() {
  if (Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf("KaizPatch") !== -1) {
    return RTMX_mergeCompatTarget(
      RTMX_COMPAT_TARGETS.kaizpatch.scripts_lib_RTMApiCompat_182qpdt,
      RTMX_COMPAT_TARGETS.mc1710.scripts_lib_RTMApiCompat_182qpdt
    );
  } else if (Packages.jp.ngt.rtm.RTMCore.VERSION.indexOf("1.7.10") >= 0) {
    return RTMX_COMPAT_TARGETS.mc1710.scripts_lib_RTMApiCompat_182qpdt;
  } else if (true) {
    return RTMX_COMPAT_TARGETS.mc1122.scripts_lib_RTMApiCompat_182qpdt;
  } else {
    return RTMX_COMPAT_TARGETS.kaizpatch.scripts_lib_RTMApiCompat_182qpdt;
  }
}

var RTMX_COMPAT_scripts_lib_RTMApiCompat_182qpdt =
  RTMX_selectCompatTarget_scripts_lib_RTMApiCompat_182qpdt();
```

common entry からの参照は、選択済み compat module 経由に変換されます。

```javascript
RTMX_COMPAT_scripts_lib_RTMApiCompat_182qpdt.RTMApiCompat.debug("...");
```

このため RTM の `render` / `onUpdate` が呼ばれるたびに target 判定することはありません。
判定は script の評価時に一度だけです。

## common API チェック

`rtmx generate` は target ごとの型定義を比較し、common から危険な API を使ったときに `RTM005` を出せるようにします。

対象になるのは次のような API です。

- ある target にしか存在しない class / method / field
- 同じ MCP 名でも target ごとに SRG 名が違う member

common 用の型定義は `generated/common/typings` に生成されます。
危険な API には common view だけ `@deprecated` が付きます。

target 固有の型定義である `generated/<target>/typings` には `@deprecated` は付きません。

### `commonApiPolicy`

`commonApiPolicy` は `RTM005` の扱いを決めます。

| 値      | 動作                                           |
| ------- | ---------------------------------------------- |
| `allow` | `RTM005` を warning として表示し、build は成功 |
| `error` | `RTM005` を error として表示し、build は失敗   |

開発中は `allow`、CI や配布前チェックでは `error` にする運用ができます。

```json
{
  "commonApiPolicy": "error"
}
```

## tsconfig

editor では common と target を別々にチェックします。

common 用 tsconfig は、`@target/*` を common 側の `*.compat.d.ts` に向けます。

```jsonc
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@target/*": ["src/common/*.compat.d.ts"],
    },
  },
  "include": ["src/common/**/*.ts", "generated/common/typings/**/*.d.ts"],
}
```

target 用 tsconfig は、`@target/*` を target 実装に向けます。

```jsonc
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@common/*": ["src/common/*"],
      "@target/*": ["src/mc1710/*.compat.ts", "src/mc1710/*"],
    },
  },
  "include": ["src/mc1710/**/*.ts", "generated/mc1710/typings/**/*.d.ts"],
}
```

## コマンド

sample では次の順番で使います。

```sh
pnpm gen
pnpm build
pnpm zip
```

`pnpm gen` は全 target の型定義と mapping を生成し、最後に common API metadata を作ります。

`pnpm build` は次の順番で出力します。

1. common entry script
2. target ごとの compat 実装
3. common 側の compat selector

`pnpm zip` は `src/` と `dist/` をまとめて配布用 zip を作ります。

## 使い分けの目安

common に書いてよいもの:

- RTM の entry function (`init`, `render`, `onUpdate` など)
- target 間で同じ意味を持つ処理
- `@target/*` で抽象化された compat API の呼び出し

compat に逃がすもの:

- Minecraft / RTM のバージョンで名前や挙動が違う field / method
- ある target にしか存在しない class
- 同じ MCP 名でも SRG 名が target ごとに違う member
- `Packages.*` を使った runtime 判定や target 固有の分岐

迷ったら、common には「何をしたいか」だけを残し、「どう実現するか」は compat に寄せると壊れにくくなります。
