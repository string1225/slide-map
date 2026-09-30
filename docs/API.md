# API 协议

后端直接路径以 `/api` 开头；Nginx 模板把 `/wechat/slide-map/api/*` 映射到 `/api/*`。JSON 请求与响应。失败返回 `{error,message}`，客户端根据 HTTP 状态处理。

| 方法               | 路径                       | 用途                                                               |
| ------------------ | -------------------------- | ------------------------------------------------------------------ |
| GET                | `/api/health`              | 健康检查，正式服务 `demo:false`                                    |
| POST               | `/api/auth/wechat`         | `{code,acceptedPrivacy:true}`；返回 token、expiresAt、公开用户资料 |
| POST               | `/api/auth/logout`         | 撤销当前会话                                                       |
| GET / PATCH        | `/api/me`                  | 当前用户及统计 / 修改 `{nickname}`                                 |
| GET / POST         | `/api/slides`              | 检索 / 发布地点                                                    |
| GET / PUT / DELETE | `/api/slides/:id`          | 详情 / 发布者编辑 / 发布者删除                                     |
| GET / PUT / DELETE | `/api/slides/:id/reviews`  | 评价列表 / 保存本人的评价 / 删除本人的评价                         |
| PUT / DELETE       | `/api/slides/:id/favorite` | 收藏 / 取消收藏，幂等                                              |
| POST               | `/api/slides/:id/report`   | `{reason}`；同一用户反馈更新同一条记录                             |

公开的地点和评论 GET 允许游客访问。其他操作、`/me` 和带 scope 的查询需要 `Authorization: Bearer <token>`。Token 为 256 位随机数，只在数据库保存 SHA-256 哈希，7 天有效，每人最多 5 个会话。OpenID 保存在服务端供身份识别及微信内容检查使用；不返回给客户端。身份只由服务器验证的微信登录 code 决定，请求中的 creatorId、userId 等字段不能改变归属。

## 地点模型

```json
{
  "title": "树荫里的波浪滑梯",
  "address": "某公园东侧儿童游乐区",
  "description": "附近有座椅，适合家长陪同游玩。",
  "latitude": 31.2304,
  "longitude": 121.4737,
  "type": "公园滑梯",
  "ageBand": "3–6岁",
  "cost": "免费",
  "amenities": ["有遮阴", "有座椅"],
  "openingHours": "以现场公示为准"
}
```

客户端坐标使用 GCJ-02，与微信 `getLocation({type:'gcj02'})`、`chooseLocation` 和 `openLocation` 一致。类型、年龄与设施枚举定义在共享 `domain.js`。经纬度拒绝字符串、空值、NaN、越界值。

## 查询与分页

`q` 对名称和地址进行字面搜索；`type`、`cost` 为枚举；`sort` 为 `newest`、`rating` 或 `distance`。纬度、经度需同时提供，`radius` 单位 km，范围 0.1–100，默认 10。不传坐标时搜索所有地点，distance 排序退化为最新分享。

`scope` 可选 `shares`、`favorites`、`reviews`，始终限定当前登录用户。`offset` 默认 0，`limit` 默认 20、最大 100。地点与评价列表返回 `{items,total,nextOffset}`；末页 nextOffset 为 null。评分排序依次为平均分、评价数、地点 ID；附近计算使用球面距离并支持跨日期线。

评价请求为 `{rating:1..5,content:"5–500字"}`，数据库唯一约束为 `(slide_id,user_id)`，更新不增加评价数量。删除地点级联删除评价、收藏和反馈。下架地点不参与公开检索、详情、评论、个人列表和统计。

## 安全与运行边界

请求体上限 16 KiB。单 IP 每分钟最多 240 次请求和 20 次登录；登录用户每分钟最多 30 次写入。Nginx 覆盖 X-Real-IP，后端只监听回环；仅在可信反代环境使用 TRUST_PROXY=1。

微信文本检查使用 msg_sec_check v2，昵称 scene=1，其余 scene=2。结果不是 pass、接口出错、缺失结果或微信不可用时拒绝写入。待人工复核的文本同样不会直接公开。举报文本不公开，供管理员处理。

数据库和会话不与演示站点共用。`/api/auth/demo` 只由本机演示进程注册，生产入口不会启用。演示脚本不应通过反向代理公开。
