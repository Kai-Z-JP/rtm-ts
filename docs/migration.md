# ES5 JS → TypeScript 移行ガイド

RTM スクリプトを従来の ES5 JavaScript から TypeScript (rtmx) に移行する手順です。

## 基本的な変換

### Java クラスの参照

**Before (JS)**
```javascript
var GL11 = org.lwjgl.opengl.GL11;
var Parts = jp.ngt.rtm.render.Parts;
```

**After (TS)**
```typescript
import { GL11 } from "org.lwjgl.opengl";
import { Parts } from "jp.ngt.rtm.render";
```

- `var X = java.some.Class` → `import { X } from "package.name"` に変換
- named import のみサポート (`import * as X` や default import は不可 → RTM001 エラー)
- パッケージ名は `rtmx.json` の `scan.packages` に含まれているものが型定義として使えるようになります 必要なパッケージを `scan.packages` に追加してから `pnpm gen` を実行して型定義を生成してください
- `importPackage(Packages...)` を使用することはできません

### 関数の型注釈

**Before (JS)**
```javascript
function init(par1, par2) {
    staticParts = renderer.registerParts(new Parts("base"));
}
```

**After (TS)**
```typescript
import { ModelSetRailClient, ModelObject } from "jp.ngt.rtm.modelpack.modelset";
import { Parts } from "jp.ngt.rtm.render";

function init(par1: ModelSetRailClient, par2: ModelObject) {
    staticParts = renderer.registerParts(new Parts("base"));
}
```

### renderer の宣言

**Before (JS)**
```javascript
var renderClass = "jp.ngt.rtm.render.RailPartsRenderer";
```

**After (TS)**
```typescript
import { RailPartsRenderer } from "jp.ngt.rtm.render";

declare const renderer: RailPartsRenderer;
// renderClass は rtmx が自動生成するので書かないでください
```

詳細は [renderer.md](./renderer.md) を参照。

### グローバル変数

**Before (JS)**
```javascript
TONG_MOVE = 0.35;

function init(par1, par2) {
    staticParts = renderer.registerParts(new Parts("base"));
}
```

**After (TS)**
```typescript
declare global {
    var TONG_MOVE: number;
    var staticParts: Parts;
}

TONG_MOVE = 0.35;

function init(par1: ModelSetRailClient, par2: ModelObject) {
    staticParts = renderer.registerParts(new Parts("base"));
}
```

`declare global` ブロック内でグローバル変数を宣言し、型注釈を付ける必要があります。

## フィールド・メソッド名

MCP 名 (難読化前の名前) でそのまま書けます。rtmx が自動的に SRG 名に変換します。

```typescript
// xCoord → field_85051_f のような変換が自動で行われる
const x = tileEntity.xCoord;
const y = tileEntity.yCoord;
const z = tileEntity.zCoord;
```

型が正しく付いていれば変換は自動です。`any` 型になっている箇所は `RTM002` 警告が出るので、型注釈を追加して解決してください。

## Nashorn で使えない構文

以下は Nashorn (RTM が使用するスクリプトエンジン) で動作しないため、rtmx がコンパイル時に警告 (`RTM004`) を出します。

| 使えないもの | 代替 |
|-------------|------|
| `Map` / `Set` | 配列や Java の HashMap で代替 |
| `async` / `await` | 同期処理に書き直す |
| `Promise` | 使用不可 |
| `Symbol` / `Proxy` | 使用不可 |

`let` / `const` やアロー関数は TypeScript が ES5 にトランスパイルする際に自動変換されるので、TypeScript 上は自由に使えます。

## ライブラリの //include

RTM の `//include <scripts/Lib.js>` を TypeScript から使う場合、通常の ES モジュールとして書いて `import` すれば、rtmx がコンパイル時に自動的に `//include` に変換します。

### ライブラリファイル

```typescript
// src/assets/minecraft/scripts/LibRenderRail.ts
import { TileEntityLargeRailCore, TileEntityLargeRailSwitchCore } from "jp.ngt.rtm.rail";
import { Point, RailDir, RailMapSwitch } from "jp.ngt.rtm.rail.util";

function renderRailDynamic2(tileEntity: TileEntityLargeRailSwitchCore, par2: number, par4: number, par6: number) {
    // ...
}
```

JS ファイルとして出力せず型定義だけを提供したい場合（別モデルパックが同名ライブラリを持つ場合など）は拡張子を `.d.ts` にしてください。

```typescript
// src/assets/minecraft/scripts/LibRenderRail.d.ts
import { TileEntityLargeRailCore, TileEntityLargeRailSwitchCore } from "jp.ngt.rtm.rail";
import { Point, RailDir, RailMapSwitch } from "jp.ngt.rtm.rail.util";

function renderRailDynamic2(tileEntity: TileEntityLargeRailSwitchCore, par2: number, par4: number, par6: number): void;
function renderPoint(tileEntity: TileEntityLargeRailSwitchCore, point: Point): void;
function renderRailMapDynamic(tileEntity: TileEntityLargeRailCore, rms: RailMapSwitch, dir: RailDir, par3: boolean, move: number, tongIndex: number): void;
function sigmoid2(x: number): number;
```

### 使用例

```typescript
// src/assets/minecraft/scripts/RenderRailStandard.ts
import { renderRailDynamic2 } from "./LibRenderRail"; // → //include <scripts/LibRenderRail.js> に変換

function renderRailDynamic(tileEntity: TileEntityLargeRailCore, posX: number, posY: number, posZ: number, par8: number, pass: number) {
    if (renderer.isSwitchRail(tileEntity)) {
        renderRailDynamic2(tileEntity as unknown as TileEntityLargeRailSwitchCore, posX, posY, posZ);
    }
}
```

- `//include` のパスは出力ファイルのパス中に `assets/minecraft/` が含まれていれば自動的にその位置を基準に計算されます。`outDir: "dist"` で `src/assets/minecraft/scripts/LibRenderRail.ts` をコンパイルした場合、`dist/assets/minecraft/` が基準となり `//include <scripts/LibRenderRail.js>` が生成されます。

## エラーコード一覧

| コード | 種別 | 内容 |
|--------|------|------|
| RTM001 | Error | named import 以外の Java import |
| RTM002 | Warning | 型が `any`/`unknown` のため SRG 変換をスキップ |
| RTM003 | Warning | マッピングに該当フィールド/メソッドが見つからない |
| RTM004 | Warning | Nashorn 非対応の構文 |

## 移行手順

- [ ] `pnpx rtmx init` でプロジェクトを作成
- [ ] `rtmx.json` に使用 mod を設定
- [ ] `pnpm gen` で型定義を生成
- [ ] `var X = java.some.Class` を `import` に変換
- [ ] `var renderClass = "..."` を `declare const renderer: T` に変換
- [ ] グローバル変数を `declare global` で宣言
- [ ] 関数の引数・戻り値に型注釈を追加
- [ ] `pnpm build` でコンパイルし、エラー・警告を確認・修正
