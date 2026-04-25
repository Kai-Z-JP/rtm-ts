# 描画スクリプトの特別仕様

描画スクリプト固有の仕様について説明します。

## renderClass の自動生成

RTM はスクリプトファイルの `renderClass` 変数を読んで、対応する Java クラスをインスタンス化します。
rtmx ではこの変数を **TypeScript の型定義から自動生成** します。

### 書き方

```typescript
import { RailPartsRenderer } from "jp.ngt.rtm.render";

declare const renderer: RailPartsRenderer;
```

`declare const renderer: <型>` と書くだけで、rtmx がコンパイル時に型の完全修飾名 (FQN) を解決し、出力 JS の先頭に以下を自動挿入します。

```javascript
var renderClass = "jp.ngt.rtm.render.RailPartsRenderer";
```

### ルール

- 変数名は必ず **`renderer`** にする（RTM の仕様）
- 型は具体的なクラス型を指定する（`any` 不可）
- `declare const` はコンパイル出力に含まれない — rtmx がかわりに `renderClass` を生成する
- 1ファイルに複数の `declare const renderer` は書かない
- `var renderClass = "..."` を自分で書く必要はない（書いても上書きされる）
