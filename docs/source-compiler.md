# 源图编译器

## 输入与命令

`source_map.svg` 是唯一 canonical 输入。运行：

```bash
npm run compile:source  # 重新生成 public/generated/*
npm run compile:check   # 内存中重编译并逐字节比较已生成文件
```

构建会先执行 `compile:check`，因此源图、编译器与已提交产物不一致时应直接失败，而不是在生产构建中悄悄改写资产。

## 解析与分类

编译器解析 SVG XML 层级、累积祖先 `transform`，把 path 命令规范化为绝对 `M/L/C/Z` 后处理。当前输入契约要求 2,288 个 path 全部被分类：

- 继承 `land`：地理陆地/边界线稿，并保留国家或地区代码；
- 继承 `lake`：湖泊线稿；
- `id/class="ocean"`：只用于推导艺术标定内框，不进入地理线稿；
- 继承 `circle`：装饰性小国标记，不进入地理线稿。

语义缺失、语义互相冲突、land 没有地区代码、path 没有 ID 或出现不支持命令都会显式报错。当前基准统计是 2,212 个地理 path（2,197 land、15 lake）、76 个装饰 path、0 个拒绝 path；这些数字是源变更哨兵，不应在替换源图时盲目沿用。

## 细分与 LOD

直线按最大段长细分；三次贝塞尔使用 De Casteljau 递归，以控制点到弦的最大距离（平坦度）和最大源平面段长共同决定停止。递归有深度保护。编译保留：

- feature 顺序、layer、country code、源 path ID；
- 每个 `M` 子路径及其 offset/count；
- 原始闭合标志，不自动闭合开放线稿。

输出两个 LOD：globe 容差较宽，用于交互球面；detail 容差更细，用于构图和导出。manifest 为各 LOD 保存独立 feature offset 表，顶层 `features` 是 detail 的 canonical 作者元数据。

## 确定性格式

- manifest 是 UTF-8、两空格缩进 JSON，并以换行结束；
- 坐标二进制是 little-endian IEEE-754 `Float32`，每点依次写 `x, y`，即每点 8 字节；
- 所有分量写入前必须为有限数；
- manifest 记录 `formatVersion`、`compilerVersion`、源 SHA-256、Public Domain 元数据、标定、统计、LOD 文件名/点数/容差和 feature offsets；
- 相同源字节和编译器版本应产生字节级相同的三个文件，`--check` 会报告首个差异字节或缺失文件。

不要手工编辑 `public/generated/`。若预期修改编译逻辑，应重新生成并同时审查 manifest 统计、hash 和二进制变化。

## 标定

`ocean` 内框的变换后包围盒作为 `xMin/xMax/yMin/yMax`，线性映射到 `[-180, 180] × [-90, 90]`。标定方法名和版本写入 manifest。它服务于原图形状的可逆艺术映射，不是对源图 CRS 的发现或恢复。
