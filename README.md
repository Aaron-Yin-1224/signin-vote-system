# 签到投票系统

一个基于 Node.js + Vue 3 的微信扫码签到投票系统，支持实时大屏展示。

## 功能特性

### ✅ 签到阶段
- 用户微信扫码授权头像
- 填写真实姓名签到
- 自动生成4位随机数字邀请码
- 提供投票链接

### ✅ 投票阶段
- 邀请码验证投票
- 链接直接投票
- 每个邀请码仅限使用一次
- 投票完成后邀请码失效

### ✅ 后台管理
- 自定义活动名称
- 设置签到/投票有效期
- 管理候选人（姓名、头像、参选奖项）
- 支持300人签到投票、100位候选人

### ✅ 大屏展示
- 左侧显示签到二维码
- 右侧显示投票二维码
- 中间签到墙实时滚动
- 投票统计图实时更新（ECharts柱状图）

## 技术栈

- **后端**: Node.js + Express
- **数据库**: SQLite (better-sqlite3)
- **实时通信**: Socket.IO
- **前端**: Vue 3 (CDN版本)
- **样式**: TailwindCSS (CDN)
- **图表**: ECharts
- **二维码**: qrcode

## 快速开始

### 1. 安装依赖

```bash
cd vote-signin-system
npm install
```

### 2. 创建数据目录

```bash
mkdir data
```

### 3. 启动服务器

```bash
npm run dev
# 或生产环境
npm start
```

### 4. 访问页面

- **管理后台**: http://localhost:3000/admin/index.html
- **大屏展示**: http://localhost:3000/screen/index.html?activityId=1
- **用户签到**: http://localhost:3000/user/signin.html?activityId=1
- **用户投票**: http://localhost:3000/user/vote.html?activityId=1

## 使用流程

### 1. 创建活动
1. 打开管理后台
2. 点击"新建活动"
3. 填写活动信息、签到/投票时间
4. 保存活动

### 2. 添加候选人
1. 进入活动管理
2. 切换到"候选人管理"标签
3. 添加候选人信息（姓名、头像URL、参选奖项）

### 3. 开始签到
1. 切换到"大屏控制"标签
2. 点击"开始签到"
3. 打开大屏页面展示二维码
4. 用户扫码签到

### 4. 开始投票
1. 签到完成后，点击"开始投票"
2. 用户使用邀请码投票
3. 大屏实时显示投票统计

### 5. 结束活动
1. 点击"结束活动"
2. 查看最终投票统计

## API 接口

### 活动管理
- `GET /api/activities` - 获取活动列表
- `GET /api/activities/:id` - 获取活动详情
- `POST /api/activities` - 创建活动
- `PUT /api/activities/:id` - 更新活动
- `DELETE /api/activities/:id` - 删除活动
- `PUT /api/activities/:id/status` - 更新活动状态

### 候选人管理
- `GET /api/activities/:activityId/candidates` - 获取候选人列表
- `POST /api/activities/:activityId/candidates` - 添加候选人
- `PUT /api/candidates/:id` - 更新候选人
- `DELETE /api/candidates/:id` - 删除候选人

### 签到
- `GET /api/activities/:id/signin-qrcode` - 获取签到二维码
- `POST /api/signin` - 提交签到
- `GET /api/activities/:id/users` - 获取签到用户列表

### 投票
- `GET /api/activities/:id/vote-qrcode` - 获取投票二维码
- `POST /api/verify-code` - 验证邀请码
- `POST /api/vote` - 提交投票
- `GET /api/activities/:id/vote-stats` - 获取投票统计

## 项目结构

```
vote-signin-system/
├── server/
│   ├── index.js          # 主服务器文件
│   └── database.js       # 数据库配置
├── client/
│   ├── admin/
│   │   └── index.html    # 管理后台
│   ├── screen/
│   │   └── index.html    # 大屏展示
│   └── user/
│       ├── signin.html   # 签到页面
│       └── vote.html     # 投票页面
├── data/
│   └── vote.db           # SQLite数据库文件
├── package.json
└── README.md
```

## 微信授权说明

当前版本使用模拟的微信授权流程。如需接入真实的微信OAuth：

1. 申请微信公众号/测试号
2. 配置授权回调域名
3. 修改 `server/index.js` 中的 `/api/wechat/auth` 接口
4. 参考[微信网页授权文档](https://developers.weixin.qq.com/doc/offiaccount/OA_Web_Apps/Wechat_webpage_authorization.html)

## 注意事项

- 数据库使用SQLite，数据存储在 `data/vote.db` 文件中
- 邀请码为4位数字，理论上有10000种组合，适合300人以内的活动
- 大屏页面需要传入 `activityId` 参数
- 建议使用Chrome浏览器以获得最佳体验

## 许可证

MIT License
