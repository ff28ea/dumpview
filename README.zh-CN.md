# dumpview

[English](./README.md) | [中文](./README.zh-CN.md)

`dumpview` 是一个面向 [Dumper-7](https://github.com/Encryqed/Dumper-7) 生成 JSON 文件的桌面查看器。这些 JSON 采用了 [Dumpspace](https://github.com/Spuckwaffel/dumpspace) 生态常用的组织方式，而这个项目的目标，就是比直接翻原始 JSON 更轻松地浏览 Unreal Engine 反射数据。

它提供本地快速搜索、符号详情查看、偏移浏览、关系弹窗、自由节点画布、UE 框架图谱、基于 GitHub 的游戏浏览页，以及明暗主题切换，并统一在 Tauri 桌面界面中呈现。

这个项目本身不会生成 dump 文件。你需要先使用 Dumper-7 导出一个 `Dumpspace` 目录，再用 `dumpview` 加载查看。

## 功能特性

- 加载 `Dumpspace` 目录，并读取 `ClassesInfo.json`、`StructsInfo.json`、`FunctionsInfo.json`、`EnumsInfo.json`，以及可选的 `OffsetsInfo.json`
- 使用本地 SQLite FTS5 建立全文索引，快速搜索类型名、字段、方法和关联符号
- 查看类、结构体、枚举的详细信息，包括父类链、直接子类、字段、方法、关联符号和反向引用
- 以更接近 C++ 的方式显示字段和方法签名，降低阅读成本
- 对共享 offset 的字段进行聚合显示，更容易识别 packed flags 和重叠字段
- 通过标题栏中的 `Offsets` 弹出面板查看偏移
- 通过详情卡片打开 `Relation View` 关系弹窗
- 通过侧边栏在 `Symbol Browser`、`Node Canvas` 和 `Game Browser` 之间切换
- 在 `Node Canvas` 中构建自由符号图，并保存为可复用的节点文件
- 打开 `Framework` 弹窗查看 UE 核心框架图谱
- 在框架图谱中递归展开子类层级，并支持平移、缩放和拖拽节点
- 浏览 Dumpspace GitHub 仓库公开的 `Games` 目录，并将远端 dump 直接加载进浏览器
- 在标题栏中切换深色和浅色主题
- 按当前加载项目保留独立的搜索历史

## 界面截图

### 主界面

![Main View](./image/main.jpg)

### 关系视图

![Relation View](./image/relationview.jpg)

### UE 框架图谱

![UE Framework Graph](./image/ueframeworkgraph.jpg)

## 技术栈

- Tauri 2
- React
- Vite
- TypeScript
- Rust
- SQLite FTS5
- React Flow + dagre，用于框架图谱和节点画布

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

其中 `OffsetsInfo.json` 是可选的，其余四个 JSON 文件必须提供。

仓库中还内置了一个示例目录 [`dump/Dumpspace`](./dump/Dumpspace)，可以直接用于快速体验。

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
npm run dev
```

在 Windows 上，本地启动脚本还会在启动 Tauri 前尝试把 `~/.cargo/bin` 加入 `PATH`，这样在已经安装 `cargo`、但当前终端看不到它的情况下，也能更稳定地启动。

如果你只想运行前端开发服务器，不启动桌面壳，可以执行：

```powershell
npm run frontend:dev
```

仓库已经通过 npm 提供了本地 Tauri CLI，因此不需要全局安装 `cargo-tauri`。

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
2. 加载仓库内置示例、选择你自己的 `Dumpspace` 目录，或者打开 `Game Browser` 从 GitHub 加载远端 dump。
3. 在 `Symbol Browser` 中按类型名、字段名、方法名或关联符号进行搜索。
4. 使用 `Node Canvas` 构建并保存自定义符号图。
5. 在主界面中继续查看详情、关系、偏移、UE 框架图谱，并按需要切换主题。

## 说明

- 最佳体验是在 Tauri 桌面应用中使用
- 一些桌面化交互并不是为普通浏览器预览模式准备的
- 当前框架图谱会从固定的 UE 核心骨架出发，再结合当前加载的 dump 数据递归展开子类
- 远端游戏浏览会读取 Dumpspace GitHub 仓库的公开目录；将远端 dump 加载进本地索引时，依然建议在 Tauri 桌面应用中使用

## 致谢

- Dumper-7: https://github.com/Encryqed/Dumper-7
- Dumpspace: https://github.com/Spuckwaffel/dumpspace
