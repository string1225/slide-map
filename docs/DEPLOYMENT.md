# 部署与微信接入

2026-09-30 已部署独立后端，发布目录为 `/opt/slide-map/releases/20260930055833`，并生成微信小程序预览版。原有 hexwar 健康检查通过；未提审或正式发布小程序。

公网健康检查：`https://www.sunny-string.cn/wechat/slide-map/api/health`；地点列表：`https://www.sunny-string.cn/wechat/slide-map/api/slides`。真实数据库初始为空，浏览器演示数据未部署。

## 独立服务

沿用 hexwar 的 Node.js + SQLite 结构，可在同一台机器上使用独立用户、目录、数据库与端口。模板预留：

| 项目          | 配置                                  |
| ------------- | ------------------------------------- |
| Node.js       | 22.13+，建议 24 LTS                   |
| 系统用户      | `slide-map`                           |
| 发布代码      | `/opt/slide-map/releases/<版本>`      |
| 当前版本      | `/opt/slide-map/current` 软链接       |
| 环境配置      | `/etc/slide-map/server.env`，root 600 |
| 数据库        | `/var/lib/slide-map/slide-map.sqlite` |
| 本机监听      | `127.0.0.1:3042`                      |
| HTTPS 路径    | `/wechat/slide-map/api/`              |
| systemd       | `deploy/slide-map.service`            |
| Nginx include | `deploy/slide-map-location.conf`      |

部署代码只需 `server/*.cjs`、`miniprogram/lib/domain.js`、`scripts/moderate.cjs`。生产服务没有 npm 运行时依赖。不要上传 `server/.env` 到可公开访问的目录，不要部署本机演示入口或 `data/demo.sqlite`。

1. 创建独立系统用户、版本目录和服务端环境目录，将指定代码上传至版本目录。
2. 在服务器受保护的环境文件中填写本 AppID 与 AppSecret，数据库设为 `/var/lib/slide-map/slide-map.sqlite`，`PORT=3042`，`TRUST_PROXY=1`。凭据不放入 shell 参数、发布包或 Git。
3. 配置 current 软链接、安装服务模板；启动后检查 `curl --fail http://127.0.0.1:3042/api/health`。应返回 `demo:false`。
4. 将 Nginx include 加入现有 HTTPS server 块，先备份配置并执行 `nginx -t`，通过后 reload。模板末尾带 `/api/` 的 proxy_pass 会正确剥离公网前缀。
5. 验证公网 HTTPS `/wechat/slide-map/api/health`，再把 `config.local.json` 的 apiBase 指向该地址的 `/api` 根路径。例如使用现有域名时为 `https://www.sunny-string.cn/wechat/slide-map/api`。重新执行 `npm run build`。

首次部署已确认端口及路径空闲。后续运行 `npm run deploy` 会生成独立版本，检查 Nginx 配置与服务健康再 reload；失败恢复原配置，保留发布包和备份用于排查。脚本会拒绝首次部署时占用已有的 3042 端口。不会重启 hexwar 服务。

## 生成预览码

运行 `npm run wechat:preview`。脚本先构建，再使用微信开发者工具配套 Node/CLI 生成带时间戳的二维码，成功后更新 `artifacts/wechat-preview.jpg`。预览要求 HTTPS API 和具有此 AppID 权限的工具登录账号。登录码和预览码不同：login 用于登录工具，preview 才用于在手机打开小程序。失效后重新运行对应命令。

本次已启用开发工具本机 CLI 服务并完成扫码登录。通过预览上传不代表位置接口、隐私指引或 request 域名配置已通过真机验收。

## 微信公众平台

使用独立小程序 AppID `wx9792f4cedeea9c45`。服务器 AppSecret 已在本机被忽略的环境文件中配置；部署时使用相同 AppID 对应的当前有效 Secret。

- 将生产 HTTPS 域名加入 request 合法域名。
- 在类目支持的前提下申请和启用 `getLocation`、`chooseLocation` 等所需位置能力。项目已在 app.json 声明相关私密接口和使用目的。
- 填写隐私保护指引，涵盖主动定位、选择地点、微信身份、公开昵称、用户提交文本与微信内容检查；客户端含隐私同意弹窗。补全 `supportEmail`，同步真实运营主体与保存/删除流程。
- 可在腾讯位置服务控制台申请此项目专用 Key，绑定小程序，填入 `tencentMapKey`（传给原生 map 的 subkey）。当前使用标准原生地图，不调用付费个性化样式、WebService 地理编码或导航插件。
- 服务器需能访问 `api.weixin.qq.com`；按后台设置把出口 IP 加入相应白名单。内容安全接口需具备调用权限。获取 access_token 成功不代表所有权限已开通。
- 登录识别不等于获取微信昵称。小程序使用用户主动填写的 nickname 输入；首次默认昵称为“滑梯探索者”，头像使用首字作为占位。
- AppSecret 不能用于 miniprogram-ci 上传。当前通过开发者工具授权账号生成预览，未提审或正式发布。改用 miniprogram-ci 时需此 AppID 专用代码上传私钥。

## 内容管理

在持有数据库访问权限的服务器上，通过同一份环境配置运行：

```sh
node --env-file=/etc/slide-map/server.env scripts/moderate.cjs reports
node --env-file=/etc/slide-map/server.env scripts/moderate.cjs hide 123
node --env-file=/etc/slide-map/server.env scripts/moderate.cjs restore 123
node --env-file=/etc/slide-map/server.env scripts/moderate.cjs resolve 1
```

数字分别为地点 ID 或反馈 ID。下架立即从列表、详情和评价接口隐藏，恢复不会丢失评价。此命令只能由运维人员在服务端执行，不开放客户端管理员入口。

## 备份与回滚

SQLite 使用 WAL 和外键。使用 SQLite 在线备份 API，或停服后完整备份数据库，避免运行中只复制主数据库而遗漏 WAL。数据库保留在版本目录之外。回滚时切换 current 指向保留的已验证版本并重启本服务，不操作 hexwar。正式升级引入 schema 变更时应先制定迁移和回滚方案。

未发布草稿仅存于用户设备；退出登录不会删除公开分享。运营方收到账号数据删除请求后，应核实身份、明确关联内容的处理方式并备份，再执行对应数据清理；当前未提供自动注销入口。

## 接口依据

- [微信官方组件与 API 示例](https://github.com/wechat-miniprogram/miniprogram-demo)
- [腾讯位置服务原生地图组件说明](https://github.com/TencentLBS/tencentmap-miniprogram-skill/blob/main/references/map_component_guide.md)
- [微信登录 code2Session](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-login/code2Session.html)
- [微信文本内容检查](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/sec-center/sec-check/msgSecCheck.html)
- [微信打开地图位置](https://developers.weixin.qq.com/miniprogram/dev/api/location/wx.openLocation.html)

微信开发文档页面在本次自动抓取中不可达；地图与权限声明同时参照微信和腾讯位置服务官方 GitHub 仓库。真实账号能力以公众平台配置及真机结果为准。
