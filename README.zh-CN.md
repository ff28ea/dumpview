# dumpview

[English](./README.md) | [Chinese](./README.zh-CN.md)

`dumpview` 是一个面向 [Dumper-7](https://github.com/Encryqed/Dumper-7) 生成 JSON 文件的桌面查看器。这些 JSON 采用了面向 [Dumpspace](https://github.com/Spuckwaffel/dumpspace) 生态的格式组织方式，这个工具的目标就是比直接翻原始 JSON 更方便地浏览 Unreal Engine 反射结构。

它提供了本地快速搜索、符号详情查看、偏移浏览、关系弹窗，以及 UE 主框架图谱，并通过 Tauri 桌面界面统一呈现。

这个项目本身不会生成 dump 文件。你需要先用 Dumper-7 导出 `Dumpspace` 目录，再通过 `dumpview` 加载查看。

## 功能特性

- 加载 `Dumpspace` 目录，并读取 `ClassesInfo.json`、`StructsInfo.json`、`FunctionsInfo.json`、`EnumsInfo.json`，以及可选的 `OffsetsInfo.json`
- 使用本地 SQLite FTS5 建立全文索引，快速搜索类型名、字段、方法和关联符号
- 查看类、结构体、枚举的详细信息，包括父类链、直接子类、字段、方法、关联类型和反向引用
- 以更接近 C++ 的方式显示字段和函数签名，降低阅读成本
- 对共享 offset 的字段进行聚合显示，更容易识别 packed flags 和重叠字段
- 通过标题栏中的 `Offsets` 弹出面板查看偏移
- 通过详情页卡片打开 `Relation View` 弹窗
- 通过标题栏中的 `Framework` 按钮打开 UE 主框架图谱
- 在框架图谱中递归展开子类层级，并支持漫游、缩放和拖动节点
- 按当前加载项目保留独立的搜索历史

## 界面截图

### 主界面

![Main View](./image/main.jpg)

### 关系视图

![Relation View](./image/relationview.jpg)

### UE 主框架图谱

![UE Framework Graph](./image/ueframeworkgraph.jpg)

## 技术栈

- Tauri 2
- React
- Vite
- TypeScript
- Rust
- SQLite FTS5
- React Flow + dagre，用于框架图谱布局与交互

## 输入目录格式

`dumpview` 期望加载一个 `Dumpspace` 目录，最小结构如下：

```text
Dumpspace/
  ClassesInfo.json
  StructsInfo.json
  FunctionsInfo.json
  EnumsInfo.json
  OffsetsInfo.json
```

其中 `OffsetsInfo.json` 是可选的，其余四个 JSON 文件应当提供。

仓库中还内置了一个示例目录 [`dump/Dumpspace`](./dump/Dumpspace)，可以直接用于体验界面。

## 快速开始

### 环境要求

- Node.js
- Rust 工具链
- 当前开发和测试主要面向 Windows 桌面环境

### 安装依赖

```powershell
npm install
```

### 启动桌面应用

```powershell
npm.cmd run tauri -- dev
```

如果你的 shell 可以直接执行 `npm`，也可以使用：

```powershell
npm run tauri -- dev
```

这个仓库已经通过 npm 提供了本地 Tauri CLI，因此不要求全局安装 `cargo-tauri`。

### 构建

前端构建：

```powershell
npm run build
```

桌面构建：

```powershell
npm.cmd run tauri -- build
```

## 使用方式

1. 启动应用。
2. 加载仓库内置示例，或者选择你自己的 `Dumpspace` 目录。
3. 按类型名、字段名、方法名或关联符号进行搜索。
4. 在结果列表中切换目标符号。
5. 在主界面中继续查看详情、关系、偏移和 UE 主框架图谱。

## 说明

- 最佳体验是在 Tauri 桌面应用中使用
- 一些桌面化交互并不是为普通浏览器预览模式准备的
- 当前框架图谱会从固定的 UE 核心骨架出发，再结合当前加载的 dump 数据递归展开子类

## 致谢

- Dumper-7：https://github.com/Encryqed/Dumper-7
- Dumpspace：https://github.com/Spuckwaffel/dumpspace
