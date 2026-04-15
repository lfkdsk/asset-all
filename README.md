# 资产总览 (Asset Tracker)

一个纯前端的个人多币种资产追踪 PWA 应用，使用 GitHub 仓库作为数据存储后端，支持离线访问、多币种自动汇率换算和资产趋势可视化。

## 功能特性

### 资产管理
- **添加 / 编辑 / 删除资产**：记录每一笔资产的名称、分类（现金、股票、基金、债券、房产、其他）、币种、金额和备注
- **智能自动补全**：输入资产名称时自动匹配国内外主流银行、券商和支付平台
- **机构品牌图标**：自动识别已知金融机构并展示品牌 Logo

### 多币种支持
- **30+ 种货币**：支持 CNY、USD、EUR、HKD、JPY、GBP、SGD 等主流货币
- **实时汇率**：通过 [Frankfurter API](https://frankfurter.dev) 获取最新汇率，自动将所有资产换算为本位币
- **汇率详情**：点击汇率日期可查看当前持有各币种的兑换汇率
- **USD 辅助显示**：当本位币非美元时，额外显示美元等值金额

### 快照与趋势
- **资产快照**：将当前资产状态保存为快照，存储到 GitHub 仓库的 `snapshots/` 目录
- **趋势图表**：基于历史快照绘制资产走势折线图，支持 1M / 3M / 6M / 1Y / 3Y / ALL 时间范围筛选
- **涨跌着色**：趋势图根据区间涨跌自动切换绿色（上涨）或红色（下跌）渐变
- **区间变化**：显示所选时间范围内的资产变化金额和百分比
- **点击回溯**：点击图表上的数据点可查看该日期的历史快照详情

### 历史数据管理
- **补录历史快照**：手动创建过去任意日期的资产快照，系统自动拉取对应日期的历史汇率
- **快照管理**：在设置中查看和删除快照，删除的快照会移至 `snapshots/trash/` 目录
- **汇率矫正**：一键对所有历史快照重新拉取对应日期的汇率并更新计算

### PWA 支持
- **离线可用**：Service Worker 缓存应用资源，离线时可查看缓存数据
- **添加到主屏幕**：支持 iOS / Android 安装为独立应用
- **自动更新**：通过 `version.json` 检测新版本，自动清除缓存并刷新

## 数据存储结构

所有数据存储在你的 GitHub 仓库中：

```
your-repo/
├── snapshots/
│   ├── index.json              # 快照索引（轻量级清单）
│   ├── 2024-01-15_uuid.json    # 各日期的完整快照
│   ├── 2024-02-01_uuid.json
│   └── trash/                  # 已删除快照的回收站
└── ...
```

每个快照文件包含完整的资产列表、汇率信息和换算后的本位币总额。

## 快速开始

### 1. 创建 GitHub 仓库

1. 登录 [GitHub](https://github.com)
2. 点击右上角 **+** → **New repository**
3. 填写仓库信息：
   - **Repository name**：取一个名字，如 `my-assets`
   - **Visibility**：选择 **Private**（强烈建议，保护你的财务数据）
4. 点击 **Create repository**
5. 记下你的 GitHub 用户名和仓库名，稍后需要用到

### 2. 创建 GitHub Personal Access Token

1. 前往 GitHub Token 设置页：点击头像 → **Settings** → 左侧栏最底部 **Developer settings** → **Personal access tokens** → **Fine-grained tokens**
2. 点击 **Generate new token**
3. 填写 Token 信息：
   - **Token name**：如 `asset-tracker`
   - **Expiration**：建议选择 90 天或更长，过期后需要重新生成
   - **Repository access**：选择 **Only select repositories**，然后选择刚创建的资产仓库
   - **Permissions** → **Repository permissions**：
     - **Contents**：设为 **Read and write**（用于读写快照文件）
4. 点击 **Generate token**
5. **立即复制 Token**（格式为 `github_pat_xxxx`），页面关闭后将无法再次查看

> 也可以使用 Classic Token：前往 **Personal access tokens** → **Tokens (classic)** → **Generate new token**，勾选 `repo` 权限即可。Classic Token 格式为 `ghp_xxxx`。

### 3. 配置应用

1. 访问应用页面（部署到 GitHub Pages 或本地打开 `index.html`）
2. 在首次设置页面填入：
   - **GitHub Token**：粘贴上一步复制的 Token
   - **仓库所有者**：你的 GitHub 用户名
   - **仓库名称**：第一步创建的仓库名
   - **分支**：默认 `main`
   - **本位币**：选择你的主要货币（如 CNY）
3. 点击 **开始使用**

## 部署方式

### GitHub Pages（推荐）

1. 将本项目代码推送到一个 GitHub 仓库（可以和数据仓库分开）
2. 进入仓库 **Settings** → **Pages**
3. Source 选择 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`
4. 保存后等待部署完成，通过 `https://<username>.github.io/<repo>/` 访问

### 本地使用

直接用浏览器打开 `index.html` 即可使用，无需任何构建工具或服务器。

## 技术栈

- 纯 HTML / CSS / JavaScript，无框架依赖
- [Chart.js](https://www.chartjs.org/) — 资产趋势图表
- [Frankfurter API](https://frankfurter.dev) — 汇率数据（免费，无需 API Key）
- [icon.horse](https://icon.horse) — 机构品牌图标
- GitHub REST API — 数据存储后端
- Service Worker — PWA 离线缓存

## 隐私与安全

- **数据完全自托管**：所有资产数据存储在你自己的 GitHub 私有仓库中
- **无后端服务器**：应用纯前端运行，不经过任何第三方服务器
- **Token 本地存储**：GitHub Token 仅保存在浏览器 localStorage 中
- **建议使用私有仓库**，并为 Token 设置最小权限（仅限单个仓库的 Contents 读写）
