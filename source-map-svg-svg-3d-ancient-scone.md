# MapTool 开发计划

## Context

当前工作区是一个绿地项目，只有 `source_map.svg` 和同几何、不同样式的 `BlankMap-World-Flattened.svg`，没有应用框架、依赖、构建系统或测试。目标是以 `source_map.svg` 的白色透明线稿为视觉与几何基础，开发一个 Web 单页制图工具：主工作区以 3D 地球展示原图线稿，用户通过经纬度矩形选区确定制图范围，再以多种投影生成 2D 作品，并导出 SVG、透明 PNG 和可继续编辑的项目 JSON。

源文件并非可直接当作 GIS 面数据使用：它包含 2,288 条以绝对三次贝塞尔曲线为主的开放路径、国家/地区语义 ID、湖泊层和装饰性小国圆圈，但几乎没有闭合面；同时它包含完整南极洲，严格按墨卡托反解会把画面垂直范围压到约 ±67°，与原图不符。为落实“原 SVG 形状优先”，首版将其明确视为经过校准的近似等距圆柱（plate carrée）艺术底图：线性映射到经纬度后包裹到球面。该定位保证默认等距圆柱投影可以近似还原原 SVG，也避免虚构地理精度；校准参数和源文件哈希会写入项目数据，今后可替换为更准确的标定而不重写渲染管线。

## 推荐技术方案

- 使用 **Vite + React + TypeScript** 构建 Web SPA。
- 使用 **Three.js + `@react-three/fiber` + `@react-three/drei`** 渲染主 3D 地球、线稿和经纬选区。
- 使用 **`d3-geo` + `d3-geo-projection`** 作为统一投影内核；首版注册 Plate Carrée、Mercator、Equal Earth、Natural Earth 1、Winkel Tripel 和 Lambert Azimuthal Equal-Area 六种投影。
- 使用 **Zustand** 管理项目状态和短期 UI 状态，使用 **Zod** 校验、版本化并迁移项目 JSON。
- 构建期使用 **XML/CSS/SVG path 解析库**（`@xmldom/xmldom`、`css-tree`、`svg-pathdata`、`transformation-matrix`）读取原 SVG；自有纯函数负责自适应贝塞尔细分、经纬标定、日期变更线切分和数据压缩。
- 2D Canvas 预览、SVG 和 PNG 导出共用一个 renderer-neutral `RenderPlan`；较重的裁剪、投影、投影后加密和导出准备放入 Web Worker，避免拖动选区时阻塞 3D 交互。
- 原始 `source_map.svg` 是唯一 canonical asset 且保持不变；`BlankMap-World-Flattened.svg` 不作为运行时依赖。应用读取构建生成的版本化 manifest 与二进制线稿数据，不直接注入原始 SVG DOM。

## 分阶段实施

### 1. 工程脚手架与源图校准验证

创建基础工程和质量工具：

- `package.json`：开发、构建、源图编译、源图一致性检查、单元测试、端到端测试脚本。
- `vite.config.ts`、`tsconfig*.json`、ESLint/格式化配置。
- `src/main.tsx`、`src/App.tsx` 和基础全屏应用样式。
- `vitest.config.ts`、`playwright.config.ts` 与测试目录。

先实现独立的源图编译/校准尖峰，再进入完整 UI：

- `scripts/compile-source-map.ts`
  - 解析 XML 层级和 `M/C/L/Z` 路径命令；累积并应用节点 transform（包括 `source_map.svg:1494`、`source_map.svg:7882` 的平移）。
  - 继承国家/地区 group 的 ID/class；保留 `land` 国家代码、`lake`、原始 path ID 等语义。
  - 排除 `class="circle"` 的装饰标注和 `id="ocean"` 的画框，不把它们当成地理线稿。
  - 以“控制点到弦的距离 + 最大经纬段长”双重阈值做自适应 De Casteljau 细分；保留每个 `M` 子路径和原始闭合标记，不进行不可靠的面化或自动闭环。
  - 每个源 path 必须被分类或显式报错；当前 2,288 个 path 不允许静默丢失。输出必须在相同源文件和工具版本下字节级确定。
  - 生成适合 3D 的 globe LOD 和高精度 detail LOD，并记录路径数、点数、包围盒、源 SHA-256、编译器版本、feature offsets 和 public-domain 元数据。
- `public/generated/source-map.manifest.json`
  - 记录以 ocean 内框为基准的 `xMin/xMax/yMin/yMax`、目标经纬范围、坐标轴方向、标定方法、源哈希、语义 feature 描述和二进制 offset。
  - 采用 `lon = (x-xMin)/(xMax-xMin)*360-180`、`lat = 90-(y-yMin)/(yMax-yMin)*180`；所有反变换也集中在同一模块。
- `public/generated/source-map-globe.bin`、`source-map-detail.bin`
  - 使用 little-endian Float32 保存变换后的源平面坐标；运行时通过 manifest feature offsets 还原层、国家、path 与 subpath 语义。detail 数据延迟到构图或导出时加载。
- `src/core/geo/calibration.ts`
  - 实现 SVG 坐标 ↔ 经纬度双向转换、校准版本检查和有限数校验。

校准关卡必须先通过，完整 UI 不得先行：

- `src/dev/CalibrationHarness.tsx` 同步展示原始 SVG、编译后 detail 线稿回投影和 Three.js 球面结果，支持透明叠加/差异图、格林尼治/太平洋缝/南北极视角、语义层开关及 dropped/nonfinite/seam-split 统计。
- Plate Carrée 回投影与原图的采样几何偏差目标不高于约 0.25–0.35 源像素，非透明像素差异初始目标低于 1%；具体阈值通过基准图调优后固化为回归夹具。
- 确认主要轮廓、南极洲、跨边界岛屿和 Sudan/South Sudan 变换正确，太平洋方向没有穿球长弦，ocean frame 不进入球面地理线稿，小国 circle 只作为可选屏幕空间标记。
- 若存在系统偏移，只调整版本化校准配置，不在组件中散布补偿常量；所有 path 均分类或给出明确拒绝原因后才能通过该阶段。

### 2. 统一领域模型、项目状态与数学内核

建立不依赖 React/Three/D3 的可测试核心：

- `src/core/model/map-document.ts`
  - 定义 `MapDocument`：源图引用/哈希/校准快照、经纬选区、投影 ID 与参数、画布尺寸、线稿/经纬网/背景样式和导出质量。
- `src/core/project/schema.ts`、`migrations.ts`、`serialization.ts`
  - 定义 `schemaVersion: 1`，使用 Zod 严格校验导入内容并为后续版本保留迁移入口。
  - 项目 JSON 保存可复现配置而非渲染缓存；导入失败要给出字段级错误，不能部分污染当前项目。
- `src/store/project-store.ts`
  - 保存会进入项目文件的状态；所有更新通过命名 action 完成。
- `src/store/ui-store.ts`
  - 保存面板开合、当前工具、拖动状态、预览质量等不进入作品文件的临时状态。
- `src/core/geo/spherical.ts`
  - 经纬度 ↔ 球面 XYZ、球面射线命中点、角度归一化、沿经线/纬线采样。
- `src/core/geo/extent.ts`
  - 选区采用 west/east/south/north 加明确的 antimeridian wrap 语义；约束纬度顺序、经度跨度和极区边界。
- `src/core/geo/split-antimeridian.ts`、`clip-polyline.ts`
  - 将经度相对选区中心解包，再进行日期变更线切分和矩形线段裁剪；跨日期变更线选区拆成两个连续窗口处理，避免横跨整张图的伪线段。

### 3. 以 3D 地球为中心的主界面

搭建主界面：全屏 3D 地球为视觉中心，右侧检查器承载选区、投影、样式和导出参数，2D 投影结果作为可展开的实时预览区；窄屏时检查器和预览改为底部抽屉，但保留地球主视图。

关键模块：

- `src/features/globe/GlobeViewport.tsx`
  - 创建相机、光照、OrbitControls、响应式尺寸和 WebGL 降级提示。
  - 使用深色低反射球体承托白色线稿；线稿位于略大于球半径的位置，避免 z-fighting。
- `src/features/globe/buildGlobeGeometry.ts`
  - 从预览 LOD 生成球面 LineSegments；超过角度阈值的段继续插值，日期变更线处断开。
  - 使用 `LineSegments2/LineMaterial` 保持屏幕空间线宽稳定，并合批减少 draw call。
- `src/features/globe/GeographicExtentOverlay.tsx`
  - 以采样后的两条经线、两条纬线显示选区，四角和边中点提供可拖拽手柄。
  - 通过相机射线与球体求交得到经纬度；拖动手柄时锁定 OrbitControls，结束后恢复。
  - 跨日期变更线时渲染为两段覆盖区域，不跨球面错误连线。
- `src/features/extent/ExtentControls.tsx`
  - 精确输入 west/east/south/north，显示 N/S/E/W、跨度和跨日期变更线状态。
  - 提供全世界、当前可见半球、重置等确定性操作；输入和球面拖动双向同步。
- `src/components/layout/AppShell.tsx`、`Inspector.tsx`、`PreviewDrawer.tsx`
  - 实现键盘可达、焦点状态、错误提示和 `prefers-reduced-motion` 支持。

拖动时球面选区以每帧即时更新；2D 预览采用约 80–120ms 防抖和可取消 worker 请求，以旧请求序号防止结果倒灌。

### 4. 投影注册表、地理裁剪与统一 2D 渲染

- `src/core/projection/registry.ts`
  - 每个投影声明稳定 ID、中文名称、类别、D3 工厂、支持参数、有效纬度/定义域、中心策略、边界构造器和 UI 描述。
  - 首版投影：
    1. Plate Carrée：默认并作为原图形状基准；
    2. Mercator：仅在选区处于约 ±85.05112878° 时可用；无效时保留精确选区并禁用生成/导出，不能静默钳位；
    3. Equal Earth：强调面积与整体均衡；
    4. Natural Earth 1：适合完整或大区域的柔和世界图；
    5. Winkel Tripel：适合世界尺度的折中构图；
    6. Lambert Azimuthal Equal-Area：以选区中心定位，适合局部/极区并验证反足点奇异性。
  - 首版不使用 Orthographic：其地平线会静默隐藏某些精确经纬矩形的一部分，违背“完整生成选区”的约束。
- `src/core/projection/createProjection.ts`
  - 默认中央经线取解包后选区的经度中心；柱状/伪柱状投影保持北向上，方位投影以选区经纬中心旋转；允许在检查器中微调有效参数。
  - 对选区四边自适应采样后计算 projected bounds，再按画布尺寸和 padding 等比 fit；不能只按已有线稿 fit，也不能分别拉伸 x/y。
  - 投影后继续以“真实投影中点与端点中点偏差”自适应加密，预览目标约 0.35px，导出约 0.1px，并设置递归/点数保护与可见警告。
- `src/core/render/buildRenderPlan.ts`
  - 先在经纬空间裁剪源线稿，再交给投影并生成唯一的 renderer-neutral `RenderPlan`；包含 revision、投影边界、source layer/country/path 元数据、line runs、callouts、经纬网、画布样式和 warning。
  - Canvas 预览、SVG 和 PNG 必须消费同一 RenderPlan；worker 按资产哈希、校准、选区、投影、画布和精度做稳定缓存，并丢弃过期 revision。
- `src/workers/projection.worker.ts`、`src/workers/protocol.ts`
  - 接收文档快照、数据 LOD 和请求 ID，返回纯序列化的 projected scene；预览与导出均调用此协议，但导出使用高精度 LOD。
- `src/features/projection/ProjectionControls.tsx`
  - 提供投影切换、自动居中、旋转、比例、画布宽高/padding 和恢复默认值。
- `src/features/projection/ProjectionPreview.tsx`
  - 以 Canvas2D 高效绘制 RenderPlan；缩放/平移只影响视图，不写回作品。透明作品在可切换的深色/棋盘预览衬底上显示，衬底不进入导出。
- `src/features/style/StyleControls.tsx`
  - 控制底图线色、线宽、透明度、linecap/linejoin，透明或纯色背景，经纬网开关/间隔/样式，选区边框显示；这些设置由预览和导出共同消费。

### 5. SVG、透明 PNG 与项目 JSON 导入导出

- `src/core/export/buildSvg.ts`
  - 从 projected scene 构造独立、无外链 SVG；设置确定的 `viewBox/width/height`，按 `map-linework`、`graticule`、`extent-frame` 分组。
  - 在国家组上保留安全化后的 country code 和 `data-source-path-id`，便于 Illustrator/Inkscape 后续编辑。
  - 透明背景时不输出背景矩形；纯色背景时显式输出第一层 rect。
- `src/core/export/exportPng.ts`
  - 直接以 Canvas2D/OffscreenCanvas 绘制同一高精度 RenderPlan，再 `convertToBlob`/`toBlob('image/png')`；保持 alpha，并提供主线程 Canvas fallback。
  - 分配画布前按 `width × height × 4` 检查内存，首版每轴上限 8192px、原始画布约 256MB 时警告/阻止，不只检查单边尺寸。
- `src/core/project/downloadProject.ts`、`loadProject.ts`
  - 导出格式化 JSON；通过文件选择器读取、Zod 校验、迁移后一次性替换项目状态。
- `src/features/export/ExportPanel.tsx`
  - 文件名、SVG/PNG/JSON、像素尺寸、透明背景、精度和导出进度；Blob URL 下载后及时 revoke。

PNG 与 SVG 必须来自同一 projected scene，避免预览、矢量和位图三套算法产生差异。

### 6. 里程碑顺序

- **M0 脚手架与契约**：工程、严格类型、核心数据契约、测试与确定性生成命令可从干净环境运行。
- **M1 预处理与校准关卡（阻塞）**：2,288 个 path 全部归类/报错，双 LOD 资产生成，回投影差异与球面缝合基准通过。
- **M2 生产 3D 地球**：批处理 land/lake 线稿、相机、加载/错误/WebGL 降级和目标帧率通过。
- **M3 精确选区**：数值输入、球面八手柄拖动、历史合并、全世界及跨日期变更线语义往返无漂移。
- **M4 投影构图**：经纬裁剪、六投影注册表、RenderPlan worker、Canvas 预览、样式与 stale-render 处理通过普通/极区/跨缝夹具。
- **M5 导出与项目便携**：高精度 SVG/PNG、JSON schema/migration/import、资产哈希校验与本地自动保存；JSON round-trip 生成相同 RenderPlan hash。
- **M6 加固发布**：单元、集成、视觉、无障碍、跨浏览器、fallback 和性能预算全部通过。

### 7. 测试、性能和交付文档

单元/集成测试：

- `src/core/geo/*.test.ts`：校准双向误差、球面转换、纬度约束、普通/跨日期变更线/极区选区、线段裁剪。
- `scripts/compile-source-map.test.ts`：固定源哈希、语义分组、排除 circle/ocean、应用 transform、输出有限坐标、LOD 误差上限。
- `src/core/projection/*.test.ts`：六种投影、自动 fit、空海域选区、非法 Mercator 极区输入、确定性输出。
- `src/core/project/*.test.ts`：JSON round-trip、未知字段/损坏文件拒绝、版本迁移。
- `src/core/export/*.test.ts`：SVG 层结构、透明背景、元数据和 viewBox；PNG 尺寸、alpha 与空白检测。

端到端和视觉验证：

- `e2e/map-workflow.spec.ts`：加载地球 → 输入普通选区 → 球面拖动 → 切换投影 → 修改样式 → 导出 SVG/PNG/JSON → 重新导入 JSON 后得到相同文档和预览。
- 覆盖欧洲局部、太平洋跨日期变更线、南极附近、全世界四个基准场景。
- Playwright 截图校验主界面、选区叠层和每类投影；下载文件解析后验证而非只验证出现下载事件。
- 在真实浏览器运行 WebGL 主流程，确认控制器与拖动手柄不会争夺指针。

性能目标与保护：

- 预览 LOD 在常见桌面设备上保持地球交互流畅；线稿合批，React 不持有逐点响应式状态。
- 投影 worker 支持请求取消/丢弃和分级精度；拖动期间使用预览 LOD，静止后再升级结果。
- 对生成数据体积、顶点数量、worker 处理时长、4K PNG 内存进行开发期统计；超出阈值时优先调整 LOD/细分误差，而不是牺牲主线程交互。

文档：

- `README.md`：安装、开发、构建、测试、重新编译源图、项目格式和浏览器要求。
- `docs/geometry-and-projections.md`：说明该 SVG 缺少 CRS、为何采用可逆的 plate-carrée 艺术标定、开放线稿限制、日期变更线规则及 Mercator 极区限制。
- `docs/project-format.md`：记录 JSON v1 字段、版本迁移和可复现性承诺。

## 关键验收标准

1. 默认全世界 Plate Carrée 输出与原 SVG 的主要线稿在同尺寸叠加时只存在设定细分容差内的差异。
2. 3D 地球使用原 SVG 编译出的国家/湖泊线稿；装饰圆圈不会出现在球面或导出的地理线稿中。
3. 数字输入与球面拖动可互相更新同一个经纬矩形，普通选区和跨日期变更线选区都无错误长连线；数值输入提供完整键盘替代，拖动时只在 pointer-up 提交一个历史动作。
4. 六种投影都使用同一裁剪、fit、加密和样式管线；Mercator 极区限制及 Lambert 方位投影奇异范围有明确提示，绝不静默修改选区。
5. SVG 可在常见矢量编辑器中打开并保留语义分组；PNG 尺寸正确且透明背景保留 alpha；JSON 重新导入后重建相同作品状态。
6. 单元、集成、Playwright 和生产构建全部通过，并完成至少一次真实浏览器中的全流程导出检查。

## 首版范围边界

首版只承诺基于原 SVG 的艺术线稿与近似经纬标定，不宣称测绘级地理精度；不进行国家面填充、任意多边形选区、在线地图数据接入、PDF 输出或桌面打包。核心模型、投影注册表和版本化项目格式会为这些后续能力保留扩展点，但不会让它们阻塞本次 Web MVP。