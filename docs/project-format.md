# 项目 JSON v1

项目文件保存可复现编辑所需的配置，不内嵌源图二进制、`RenderPlan`、预览缓存、面板开合或拖动状态。默认下载名为 `maptool-project.json`，MIME 类型为 `application/json`。

## 顶层

```json
{
  "schemaVersion": 1,
  "document": {}
}
```

v1 使用严格校验：对象中的未知字段会被拒绝，所有数值必须为有限数。导入顺序是读取文本、解析 JSON、按版本迁移、完整校验，全部成功后才一次性替换当前文档；失败不会应用部分字段。

当前仅接受 `schemaVersion: 1`。迁移入口已独立设置，但尚无旧版本迁移规则；缺失或未知版本都会报错。

## `document`

### `source`

| 字段          | 类型   | 说明                                        |
| ------------- | ------ | ------------------------------------------- |
| `file`        | string | canonical 源文件名，当前为 `source_map.svg` |
| `sha256`      | string | 64 位十六进制源文件 SHA-256                 |
| `calibration` | object | 随项目保存的标定快照                        |

标定快照 v1 必须是：`version: 1`、`method: "artistic-plate-carree"`、有限的 `xMin < xMax` 与 `yMin < yMax`、`longitudeRange: [-180, 180]`、`latitudeRange: [-90, 90]`、`yAxis: "down"`。快照与哈希用于识别作品所依赖的源几何；它们不是把源资产内嵌进项目。

### `extent`

```json
{
  "west": -20,
  "east": 40,
  "south": 30,
  "north": 70,
  "wrapsAntimeridian": false
}
```

经度范围为 `[-180, 180]`，纬度范围为 `[-90, 90]`，且 `south < north`。普通范围要求 `west < east`；跨日期变更线时 `wrapsAntimeridian` 为 `true` 且 `west > east`。

### `projection`

```json
{
  "id": "plate-carree",
  "parameters": {}
}
```

`id` 是稳定投影 ID；当前 UI 提供 `plate-carree`、`mercator`、`equal-earth`、`natural-earth-1`、`winkel-tripel`、`lambert-azimuthal-equal-area`。`parameters` 的键为字符串，值只能是有限 number、boolean 或 string。schema 负责结构验证；投影是否支持某参数及其地理定义域由投影层进一步验证。

### `canvas`

| 字段              | 约束                                            |
| ----------------- | ----------------------------------------------- |
| `width`、`height` | `1..8192` 的整数                                |
| `padding`         | `0..4096` 的有限数，且两倍 padding 小于画布短边 |

### `style`

- `linework`：`color`、正数 `width`、`opacity`（0..1）、`lineCap`（`butt/round/square`）、`lineJoin`（`bevel/round/miter`）。
- `graticule`：`visible`、正数 `longitudeInterval`（最大 360）、正数 `latitudeInterval`（最大 180）、`color`、正数 `width`、`opacity`（0..1）。
- `background`：`color` 为颜色字符串或 `null`；`null` 表示透明。
- `extentFrame`：`visible`、`color`、正数 `width`。

颜色字段在 v1 中要求非空字符串；schema 本身不把它限制为特定 CSS 色值格式。

### `exportQuality`

取值为 `preview`、`standard` 或 `high`。它是导出精度意图，不是已生成图像或缓存。

## 完整示例

```json
{
  "schemaVersion": 1,
  "document": {
    "source": {
      "file": "source_map.svg",
      "sha256": "e6df9bb3ed524d4c256424a4112ffb15db0aa71f17e30b2416faa87406498273",
      "calibration": {
        "version": 1,
        "method": "artistic-plate-carree",
        "xMin": -28.9472,
        "xMax": 2723.1798,
        "yMin": 61.9866,
        "yMax": 1457.5605,
        "longitudeRange": [-180, 180],
        "latitudeRange": [-90, 90],
        "yAxis": "down"
      }
    },
    "extent": {
      "west": -20,
      "east": 40,
      "south": 30,
      "north": 70,
      "wrapsAntimeridian": false
    },
    "projection": {
      "id": "equal-earth",
      "parameters": {}
    },
    "canvas": {
      "width": 1600,
      "height": 900,
      "padding": 32
    },
    "style": {
      "linework": {
        "color": "#f5f5f5",
        "width": 1,
        "opacity": 1,
        "lineCap": "round",
        "lineJoin": "round"
      },
      "graticule": {
        "visible": true,
        "longitudeInterval": 15,
        "latitudeInterval": 15,
        "color": "#8a8a8a",
        "width": 0.5,
        "opacity": 0.45
      },
      "background": { "color": null },
      "extentFrame": {
        "visible": false,
        "color": "#ffffff",
        "width": 1
      }
    },
    "exportQuality": "standard"
  }
}
```

## 可复现性边界

v1 记录源哈希、标定、范围、投影参数、画布、样式和质量，因此同版本资产与算法应可重建同一作品状态。它不承诺不同浏览器的 PNG 编码字节完全相同，也不保证未来编译器或投影库升级后的输出自动与旧版本逐像素一致；消费者应检查源哈希和版本，并保留迁移/兼容处理。
