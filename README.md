# MapTool

MapTool 是一个以 `source_map.svg` 艺术线稿为底图的 Web 制图工具。它把线稿标定到近似经纬坐标，在 3D 地球上选择范围，并通过统一的渲染数据生成 2D 预览以及 SVG、透明 PNG 和可继续编辑的项目 JSON。

> 本项目保留原图形状优先，不提供测绘级坐标精度；详见[几何与投影](docs/geometry-and-projections.md)。

## 环境要求

- Node.js 22 或更高版本（仓库同时提供 `.nvmrc`）
- npm（使用仓库中的 `package-lock.json`）
- 支持 ES2022、Canvas 2D、Web Worker 和 WebGL 的现代浏览器

## 安装与开发

```bash
npm ci
npm run dev
```

Vite 会在终端显示开发地址。不要直接双击 `index.html`；源图资产通过 HTTP 加载。

## 构建与预览

```bash
npm run build
npm run preview
```

`build` 会先以 `compile:check` 检查已提交源图产物，再执行 TypeScript 构建和 Vite 生产构建，输出目录为 `dist/`。

## 检查与测试

```bash
npm run typecheck       # TypeScript
npm run lint            # ESLint
npm run format:check    # Prettier 检查
npm test                # Vitest 单元/集成测试
npm run test:watch      # Vitest 监听模式
npm run test:e2e        # Playwright 端到端测试
npm run check           # typecheck + lint + test + build
```

Playwright 首次运行前可能需要安装浏览器：

```bash
npx playwright install
```

端到端配置会自动启动本地 Vite 服务，并按 Chromium、Firefox、WebKit 三个项目运行。当前测试范围和未覆盖项见[测试与性能](docs/testing-and-performance.md)；文档不代表上述命令已在你的机器或当前提交上全部执行成功。

## 重新编译源图

`source_map.svg` 是唯一 canonical 源图；`BlankMap-World-Flattened.svg` 不参与运行时加载。修改源图或编译器后运行：

```bash
npm run compile:source
npm run compile:check
```

生成文件位于 `public/generated/`：

- `source-map.manifest.json`：格式/编译器版本、源 SHA-256、艺术标定、分类统计与各 LOD feature offset；
- `source-map-globe.bin`：球面预览 LOD；
- `source-map-detail.bin`：构图与导出用 detail LOD。

二进制是 little-endian `Float32` 的交错 `(x, y)` 分量。编译器要求所有源 path 被归为 land、lake 或明确的装饰路径；输出一致性检查按字节比较。完整约束见[源图编译器](docs/source-compiler.md)。

## 使用与文件

1. 在“地理范围”中输入西、东、南、北边界；西界大于东界表示跨日期变更线范围。
2. 在“投影与画布”中选择投影并设置画布尺寸。
3. 调整线稿、背景、经纬网和范围边框样式。
4. 导出 SVG、PNG 或项目 JSON；导入 JSON 时会先完整校验，失败不会部分替换当前项目。

项目文件当前为严格的 JSON v1，顶层是 `schemaVersion` 与 `document`。它保存可复现的编辑配置，不保存 RenderPlan、二进制线稿或临时 UI 状态。字段说明见[项目 JSON v1](docs/project-format.md)。

## 设计说明

- [几何与投影](docs/geometry-and-projections.md)
- [项目 JSON v1](docs/project-format.md)
- [源图编译器](docs/source-compiler.md)
- [测试与性能](docs/testing-and-performance.md)
