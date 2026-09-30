# 滑滑梯地图

一起发现下一处快乐。微信原生小程序，用地图分享各地的滑滑梯，支持位置标记、选点发布、导航、收藏、评分和评价。

![Logo](assets/logo.png)

参考相邻 hexwar 项目的 Node.js + SQLite 后端结构，使用独立 AppID `wx9792f4cedeea9c45`。这是 **小程序**，项目类型为 `miniprogram`，不是 Canvas 小游戏。

## 本地运行

需要 Node.js 22.13+（建议 Node.js 24 LTS），生产运行时无第三方 npm 依赖。

```sh
npm install
npm run check
npm run dev
```

- 浏览器交互演示：<http://127.0.0.1:5186>。示意地图和虚构地点，使用独立 `data/demo.sqlite`；演示账号仅用于本机测试。
- 微信小程序 API：<http://127.0.0.1:3042/api/health>。配置 `server/.env` 后，开发脚本同时启动真实后端；实际数据在 `data/slide-map.sqlite`，首次运行为空。
- 端口被占用时用 `DEV_PORT` 更改浏览器演示端口。演示仅监听回环地址，勿部署 `scripts/dev.cjs` 到公网。

初次设置时复制 `server/.env.example` 为 `server/.env`，填写此小程序的 AppID、AppSecret，把 `SLIDE_MAP_DB` 改为 `data/slide-map.sqlite`，本机 `TRUST_PROXY=0`。当前工作区已配置，环境文件被 Git 忽略。AppSecret 不进入客户端、构建产物或 Git。

## 导入微信开发者工具

1. 执行 `npm run build`。
2. 导入**仓库根目录**，项目类型选“小程序”。`project.config.json` 指向 `dist/wechat/`。
3. 小程序默认连接 `https://www.sunny-string.cn/wechat/slide-map/api`，已部署独立服务。需要本机 API 时，将 config.local.json 的 apiBase 改为 `http://127.0.0.1:3042/api`；本机请求仅用于开发工具调试。
4. 客户端配置需要变更时，复制 `config.example.json` 为 `config.local.json`，设置 `apiBase`、运营联系邮箱 `supportEmail`、可选腾讯地图 `tencentMapKey`，重新构建。使用自定义 AppID 时导入 `dist`，其中生成的项目配置会同步 AppID。
5. 每次修改源码后重新构建，再在开发者工具中编译。

AppSecret 仅用于微信登录与内容安全检查；**不是**小程序代码上传私钥。当前预览使用已登录的微信开发者工具，无需上传私钥。工具登录后运行 `npm run wechat:preview`，二维码输出到 `artifacts/wechat-preview.jpg`（同时保留带时间戳的文件）。如需重登，执行开发工具 CLI 的 login 命令扫码。可通过 WECHAT_DEVTOOLS_CLI 指定 cli.bat 路径。

`npm run deploy` 将独立 API 发布到 hexwar 所在的 aliyun-139 服务器；凭据通过 SSH 标准输入写入 root 专用环境文件，不进入发布包。Nginx 检查与健康检查失败会回滚部署配置。详见部署说明。

## 已实现

- 腾讯地图原生 `map`：坐标标记、点击标记查看、附近检索、拖动或缩放后搜索区域；支持切换列表。
- 搜索名称、地址或城市；按场地类型、免费筛选，按距离或评分排序；列表分页。
- `wx.chooseLocation` 选点发布：名称、地址、介绍、场地类型、适合年龄、收费、开放时间和设施。未发布草稿保存在本机。
- `wx.openLocation` 打开微信位置详情，可从中进入路线导航；分享卡片可直接进入滑梯详情。
- 1–5 星评分与文字评价；每个用户每个地点最多一条，可更新、删除，评分始终从有效评价聚合，不能评价自己的分享。
- `wx.login` / 服务端 code2Session 识别身份；昵称由用户主动填写，头像显示昵称首字，不采集头像照片、手机号或真实姓名。
- 收藏、我的分享／评价／收藏、编辑和删除自己的地点；举报、管理员下架与恢复。
- 生产提交的昵称、地点文本和评价通过微信内容安全检查；检查失败时不保存待发布内容。
- 隐私授权弹窗、拒绝定位后的浏览路径、草稿恢复、网络失败提示、登录过期处理。

## 目录

```text
miniprogram/       微信原生页面、地图与用户交互
miniprogram/lib/   客户端 API 和前后端共享的数据校验
server/           HTTP API、微信登录、SQLite 与内容检查
web/              浏览器交互演示（不是微信渲染器）
assets/logo.png   原创小程序 Logo
scripts/          构建、开发启动、演示数据、管理员工具
tests/            身份隔离、评分、地图检索、持久化及客户端回归测试
deploy/           独立 systemd 服务与 Nginx 反向代理模板
docs/             部署、接口、验证与 Logo 说明
```

## 上线前接入

后端部署模板和微信后台设置见 [部署说明](docs/DEPLOYMENT.md)，接口见 [API](docs/API.md)，验证记录见 [验证说明](docs/VALIDATION.md)。Logo 提示词与生成方式见 [品牌说明](docs/BRAND.md)。

2026-09-30 已部署公网 API 并生成小程序预览二维码，未提审或正式发布。公网数据库初始为空，不包含演示地点。微信后台的请求域名、位置接口权限、隐私保护指引和运营方联系方式仍需核对，并完成微信真机验收。原生腾讯地图接入参考 [腾讯位置服务官方组件文档](https://github.com/TencentLBS/tencentmap-miniprogram-skill/blob/main/references/map_component_guide.md)；位置权限声明参考 [微信官方示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/miniprogram/app.json)。

MIT License。
