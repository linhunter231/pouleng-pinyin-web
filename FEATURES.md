# 现有功能说明（OCR 校对页）

> 页面路径：`/ocr-check`。本页面为 Next.js 客户端组件，提供图片与 OCR 文本的叠加、编辑与保存功能。

## 页面概览
- 两栏布局：左侧显示图片，右侧显示按坐标缩放后的 OCR 文本叠加层。
- 顶部粘性工具栏：始终可见，`z-index` 设为较高以避免被叠加标签覆盖。
- 文件导航：支持上一页/下一页与下拉选择具体文件名。

## 数据加载
- 文件名列表：从 `GET /api/files` 获取，作为可浏览的页集合。
- 图片加载：根据当前文件名构造 `src` 为 `/images/wdzh/{name}.png`，渲染后在 `onLoad` 中记录 `naturalWidth/naturalHeight` 与实际渲染尺寸。
- 原始尺寸：从 `GET /api/image-info?imageName={name}.png` 获取原图尺寸，用于将 OCR 坐标映射到渲染区域。
- OCR JSON：从 `/ocr_results/wdzh/{name}.json` 读取，兼容 `Response.TextDetections` 与顶层 `TextDetections` 两种结构。

## 叠加与渲染
- 每条检测项按 `ItemPolygon` 的 `X/Y/Width/Height` 与原始/渲染尺寸的比例，计算叠加框的绝对定位。
- 文本样式：字体大小随缩放比例自适应，超出部分采用 `ellipsis` 处理。
- 颜色：根据 `Confidence` 动态调整文字不透明度（100、99、98 为不同等级，其他较低）。

## 编辑功能
- `DetectedText`：
  - 直接在叠加框中可编辑（`contentEditable`），失焦时写回到 `ocrData`。
  - 提供拼音字符按钮（两行），支持在光标处插入带声调的拼音字符；插入后恢复光标位置。
- `pageno` 标签（显示于框左上）：
  - 可编辑，失焦时解析为数字并写入到 `AdvancedInfo.Parag.ParagNo`（按 JSON 序列化存储）。
  - 初始显示从 `AdvancedInfo.Parag.ParagNo` 中解析获得，解析失败时显示空字符串。
- `Confidence` 标签（显示于框右上）：
  - 可编辑，失焦时解析为数字并写回当前检测项的 `Confidence`。

## 键盘交互
- `Shift+Enter`：在可编辑元素中插入可见换行（通过 `insertLineBreakAtCaret()` 在光标处插入 `<br>`）。
- `Enter` 或按住 `Ctrl` 的 `Enter`：退出编辑并触发保存（统一走失焦保存逻辑）。

## 保存与还原
- 保存所有更改：点击“保存所有更改”按钮向 `POST /api/save-ocr` 发送当前 `ocrData`（数组），弹窗提示成功或失败。
- 还原更改：点击“重置所有更改”恢复为初次加载时的 `initialOcrData`。

## 视觉层级与滚动
- 工具栏：`sticky top-0` 并提升为高层级，确保滚动时不会被叠加标签覆盖。
- 标签层级：`pageno` 与 `Confidence` 的 `z-index` 设为较低值，使其不会压过工具栏。

## 错误处理与状态
- 加载状态：`loading` 标记，用于在数据/图片加载时进行状态控制。
- 错误状态：`error` 捕获网络或解析错误，控制页面反馈。

## 已知约束
- `pageno` 与 `Confidence` 在保存时按数值解析；若需改为字符串存储需调整保存逻辑与类型定义。
- 图片路径与 JSON 路径目前固定在 `wdzh` 子目录命名下（可视需求抽象为可配置）。

## 相关工具函数
- `insertLineBreakAtCaret()`：在 `contentEditable` 元素的当前光标处插入 `<br>` 并将光标移至其后。

## 运行与预览
- 开发服务器：`npm run dev`。
- 预览地址示例：`http://localhost:3000/ocr-check`（具体端口以本地运行环境为准）。