## 快速目标

该仓库是一个 Next.js (app router) 的拼音查询工具，服务端负责在构建/SSR 时加载并合并本地字典，客户端负责交互式查询与展示。AI 代码助手的主要目标是：快速理解数据流（字典 -> server loader -> client component），掌握字典格式与合并规则，并避免覆盖本地 OCR 数据或误修改 public 下的生成文件。

## 关键文件与入口（优先阅读）

- `src/app/page.tsx` — 服务端入口；在 SSR 阶段调用 `loadServerDictionaries` 并把合并后的字典以 prop 传给客户端组件 `DictionarySearch`。
- `src/lib/server-dictionary-utils.ts` — 在服务器上读取 `public/dictionaries/*` 的实现，使用 `process.cwd()` + `public` 路径。注意：它以文件路径包含 `Pouleng` 来决定来源类型为 `pouleng`。
- `src/data/dictionary.ts` — 包含数据模型与主要逻辑：`parseDictionaryFile`, `lookupPinyinForSentence`, `searchDictionary`, `sortPinyins`。这是拼音映射与简繁转换（依赖 opencc-js）的核心，任何与拼音合并或读取相关的改动都应首先在此处考虑兼容性。
- `src/components/DictionarySearch.tsx` — 客户端 UI（'use client'）。它期望 `initialDictionary: DictionaryEntry[]`，并实现：句子分段、点击切换读音、复制结果、URL 参数读取（`readingPreference` 与 `debug`）。
- `public/dictionaries/` — 放置字典文件，代码通过相对路径（例如 `/dictionaries/Pouleng.dict.yaml`）引用它们。
- `src/app/api/*` — 简单 API：
  - `api/files/route.ts` GET 返回 images/ocr 的公共文件名（用于前端列表）。
  - `api/image-info/route.ts` GET?imageName= 返回图片宽高（使用 image-size）。
  - `api/save-ocr/route.ts` POST 将前端 OCR 数据合并写回 `public/ocr_results/wdzh/dic-017.json`（小心：这是写磁盘的端点）。

## 数据格式与约定（必须遵守）

- 字典文件解析：`parseDictionaryFile` 将文件按行分割并使用 tab 分段（`word\t pinyin\t optional definition`）。不要把任意 YAML 结构当作树形解析器——当前实现是行+TAB 的扁平解析。
- pinyin 类型会被标记为 `'文' | '白' | 'pouleng' | 'unknown'`。如果 definition 中包含 `文读` 或 `白读`，解析器会据此标记；否则若文件来源为 `pouleng` 则标为 `pouleng`。
- 合并策略：`loadServerDictionaries` 以单字 `word` 为 key，合并 `pinyin` 列表，去重依据是 `value` 与 `type`。对 definition 的处理是“保留第一次遇到的定义（默认）”。

## 开发 / 调试流程（可复制执行）

- 启动本地开发服务器：`npm install` 然后 `npm run dev`（项目 package.json 使用 `next dev --turbopack`）。页面默认在 http://localhost:3000。
- 构建：`npm run build`（使用 turbopack），上线/预览使用 `npm run start`。
- 前端调试：打开任意页面并在 URL 上添加 `?debug=1` 或 `?readingPreference=白` 来触发组件的 URL 参数读取逻辑。
- 注意：`api/save-ocr` 会写入 `public/ocr_results/wdzh/dic-017.json`，在改写前务必备份或在本地使用 git 以便回滚。

## 代码修改建议与常见模式

- 新增字典：把文件放进 `public/dictionaries/`，并在 `src/app/page.tsx` 的 `dictionaryFiles` 数组中添加相对路径（例如 `/dictionaries/My.dict.txt`）。服务端加载会自动合并。
- 若需改进解析器：修改 `src/data/dictionary.ts::parseDictionaryFile`，保持向后兼容（保证老文件仍能按行+TAB解析）。
- 如需支持真正的 YAML 结构或更复杂的字典格式，请在 `server-dictionary-utils.ts` 新增分支并明确 sourceType；但先保留现有行式解析以免破坏当前数据。
- 对于拼音优先级逻辑，首选修改 `sortPinyins`，它负责把 `文/白/pouleng` 排到期望顺序。

## 安全与危险点（AI 助手必读）

- 切勿直接修改 `public/ocr_results/` 或 `public/images/` 中的已存在文件，除非明确要更新 OCR 内容（使用 `api/save-ocr` 需谨慎）。
- `server-dictionary-utils.ts` 在服务器端使用 `fs.readFile` 读取 `public` 文件，任何 Node 层改动都有可能影响 SSR 构建阶段。

## Types / Shapes（简要示例）

- DictionaryEntry: `{ word: string; pinyin: PinyinDetail[] }`
- PinyinDetail: `{ value: string; type: '文'|'白'|'pouleng'|'unknown'; definition?: string; fromTraditional?: boolean; fromSimplified?: boolean }`
- lookupPinyinForSentence 返回的 segment 含 `type: 'char'|'word'`, `pinyin: PinyinDetail[]`, `selectedPinyinIndex` 等字段，客户端依赖这些字段进行渲染与交互。

## 小贴士 / 快速示例

- 想要在本地添加并测试新字典：
  1. 把 `My.dict.txt` 放到 `public/dictionaries/`，保持 `word\t pinyin\t optional definition` 格式。
  2. 在 `src/app/page.tsx` 的 `dictionaryFiles` 中加入 `/dictionaries/My.dict.txt`。
  3. 启动 `npm run dev`，打开主页并搜索验证。

如果有希望我补充的示例（例如：示例字典行、如何单元测试 `lookupPinyinForSentence`），告诉我需要的细节，我会把它加到此文件中。
