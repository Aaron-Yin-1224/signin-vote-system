const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');
const XLSX = require('xlsx');
const multer = require('multer');
const { initDatabase, query, run, get } = require('./database');
const path = require('path');
const fs = require('fs');

// 创建上传目录
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 配置 multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('只支持上传图片文件（jpg、png、gif、webp）'));
    }
  }
});

// 初始化数据库
initDatabase().then(() => {
  console.log('🚀 数据库初始化完成，服务器启动中...');
}).catch((err) => {
  console.error('❌ 数据库初始化失败:', err);
  process.exit(1);
});

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// 静态文件服务
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/admin', express.static(path.join(__dirname, '../client/admin')));
app.use('/screen', express.static(path.join(__dirname, '../client/screen')));
app.use('/user', express.static(path.join(__dirname, '../client/user')));

// ==================== 活动管理接口 ====================

// 创建活动
app.post('/api/activities', (req, res) => {
  const {
    name, signin_name, vote_name,
    signin_start_time, signin_end_time,
    vote_start_time, vote_end_time
  } = req.body;

  const result = run(`
    INSERT INTO activities (name, signin_name, vote_name, signin_start_time, signin_end_time, vote_start_time, vote_end_time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [name, signin_name, vote_name, signin_start_time, signin_end_time, vote_start_time, vote_end_time]);
  
  res.json({ success: true, activityId: result.lastInsertRowid });
});

// 获取活动列表
app.get('/api/activities', (req, res) => {
  const activities = query('SELECT * FROM activities ORDER BY created_at DESC');
  res.json(activities);
});

// 获取活动详情
app.get('/api/activities/:id', (req, res) => {
  const activity = get('SELECT * FROM activities WHERE id = ?', [req.params.id]);
  if (!activity) {
    return res.status(404).json({ error: '活动不存在' });
  }
  
  // 获取候选人
  activity.candidates = query('SELECT * FROM candidates WHERE activity_id = ?', [req.params.id]);
  
  // 获取签到人数和投票人数
  const signinCount = get('SELECT COUNT(*) as count FROM users WHERE activity_id = ?', [req.params.id]);
  const voteCount = get('SELECT COUNT(*) as count FROM users WHERE activity_id = ? AND has_voted = 1', [req.params.id]);
  
  activity.signin_count = signinCount?.count || 0;
  activity.vote_count = voteCount?.count || 0;
  
  res.json(activity);
});

// 更新活动状态
app.put('/api/activities/:id/status', (req, res) => {
  const { status } = req.body;
  run('UPDATE activities SET status = ? WHERE id = ?', [status, req.params.id]);
  
  io.emit('activity-status-changed', { activityId: req.params.id, status });
  
  res.json({ success: true });
});

// 更新活动信息
app.put('/api/activities/:id', (req, res) => {
  const {
    name, signin_name, vote_name,
    signin_start_time, signin_end_time,
    vote_start_time, vote_end_time
  } = req.body;

  run(`
    UPDATE activities 
    SET name = ?, signin_name = ?, vote_name = ?, 
        signin_start_time = ?, signin_end_time = ?, 
        vote_start_time = ?, vote_end_time = ?
    WHERE id = ?
  `, [name, signin_name, vote_name, signin_start_time, signin_end_time, vote_start_time, vote_end_time, req.params.id]);
  
  res.json({ success: true });
});

// 删除活动
app.delete('/api/activities/:id', (req, res) => {
  run('DELETE FROM votes WHERE activity_id = ?', [req.params.id]);
  run('DELETE FROM users WHERE activity_id = ?', [req.params.id]);
  run('DELETE FROM candidates WHERE activity_id = ?', [req.params.id]);
  run('DELETE FROM activities WHERE id = ?', [req.params.id]);
  
  res.json({ success: true });
});

// ==================== 候选人管理接口 ====================

// 上传候选人头像
app.post('/api/upload/candidate-avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请选择图片文件' });
  }
  const avatarUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: avatarUrl });
});

// 添加候选人
app.post('/api/activities/:activityId/candidates', (req, res) => {
  const { name, avatar, award } = req.body;
  const activityId = req.params.activityId;
  
  const result = run('INSERT INTO candidates (activity_id, name, avatar, award) VALUES (?, ?, ?, ?)', 
    [activityId, name, avatar, award]);
  
  res.json({ success: true, candidateId: result.lastInsertRowid });
});

// 批量添加候选人
app.post('/api/activities/:activityId/candidates/batch', (req, res) => {
  const { candidates } = req.body;
  const activityId = req.params.activityId;
  
  let count = 0;
  for (const c of candidates) {
    if (c.name && c.name.trim()) {
      run('INSERT INTO candidates (activity_id, name, avatar, award) VALUES (?, ?, ?, ?)', 
        [activityId, c.name.trim(), c.avatar || '', c.award || '']);
      count++;
    }
  }
  
  res.json({ success: true, count });
});

// 下载候选人导入模板
app.get('/api/candidates/template', (req, res) => {
  const workbook = XLSX.utils.book_new();
  
  // 模板数据
  const templateData = [
    ['姓名*', '头像URL（选填）', '参选奖项（选填）'],
    ['张三', 'https://example.com/avatar1.jpg', '最佳创新奖'],
    ['李四', '', '最佳团队奖'],
    ['王五', '', '']
  ];
  
  const worksheet = XLSX.utils.aoa_to_sheet(templateData);
  
  // 设置列宽
  worksheet['!cols'] = [
    { wch: 15 },
    { wch: 40 },
    { wch: 20 }
  ];
  
  XLSX.utils.book_append_sheet(workbook, worksheet, '候选人列表');
  
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  
  res.setHeader('Content-Disposition', 'attachment; filename=candidates_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// 批量导入候选人（Excel上传）
app.post('/api/activities/:activityId/candidates/import', express.raw({ type: 'application/octet-stream', limit: '5mb' }), (req, res) => {
  try {
    const activityId = req.params.activityId;
    const workbook = XLSX.read(req.body, { type: 'buffer' });
    
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // 跳过标题行
    const candidates = data.slice(1).filter(row => row[0] && String(row[0]).trim());
    
    let count = 0;
    for (const row of candidates) {
      const name = String(row[0] || '').trim();
      const avatar = String(row[1] || '').trim();
      const award = String(row[2] || '').trim();
      
      if (name) {
        run('INSERT INTO candidates (activity_id, name, avatar, award) VALUES (?, ?, ?, ?)', 
          [activityId, name, avatar, award]);
        count++;
      }
    }
    
    res.json({ success: true, count, message: `成功导入 ${count} 位候选人` });
  } catch (err) {
    console.error('导入失败:', err);
    res.status(500).json({ error: '导入失败，请检查文件格式' });
  }
});

// 获取候选人列表
app.get('/api/activities/:activityId/candidates', (req, res) => {
  const candidates = query('SELECT * FROM candidates WHERE activity_id = ? ORDER BY vote_count DESC, id ASC', [req.params.activityId]);
  res.json(candidates);
});

// 更新候选人
app.put('/api/candidates/:id', (req, res) => {
  const { name, avatar, award } = req.body;
  run('UPDATE candidates SET name = ?, avatar = ?, award = ? WHERE id = ?', [name, avatar, award, req.params.id]);
  res.json({ success: true });
});

// 删除候选人
app.delete('/api/candidates/:id', (req, res) => {
  run('DELETE FROM candidates WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ==================== 签到接口 ====================

// 获取签到二维码
app.get('/api/activities/:id/signin-qrcode', async (req, res) => {
  const activityId = req.params.id;
  const baseUrl = req.protocol + '://' + req.get('host');
  const signinUrl = `${baseUrl}/user/signin.html?activityId=${activityId}`;
  
  try {
    const qrcodeDataUrl = await QRCode.toDataURL(signinUrl, {
      width: 300,
      margin: 2
    });
    res.json({ qrcode: qrcodeDataUrl, url: signinUrl });
  } catch (err) {
    res.status(500).json({ error: '生成二维码失败' });
  }
});

// 微信授权（真实场景需要微信公众号/小程序的 appid 和授权回调）
// 当前为模拟实现：生成随机用户信息 + 随机头像（网络随机头像 API）
app.post('/api/wechat/auth', (req, res) => {
  const { code, activityId } = req.body;
  
  const uid = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  // 使用 ui-avatars.com 生成带名字的首字母头像，更真实
  const nicknames = ['参会用户', '活动嘉宾', '现场人员', '签到来宾'];
  const nickname = nicknames[Math.floor(Math.random() * nicknames.length)] + Math.floor(Math.random() * 100);
  const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(nickname)}&background=0D8ABC&color=fff&size=128&bold=true`;
  
  const mockUserInfo = {
    openid: 'wx_' + uid,
    nickname: nickname,
    headimgurl: avatar
  };
  
  res.json(mockUserInfo);
});

// 签到
app.post('/api/signin', (req, res) => {
  const { activityId, openid, nickname, avatar, realName } = req.body;
  
  // 检查是否已签到（同一活动同一微信用户仅限1次）
  const existingUser = get('SELECT * FROM users WHERE openid = ? AND activity_id = ?', [openid, activityId]);
  if (existingUser) {
    return res.status(400).json({ error: '您已签到，请勿重复签到', inviteCode: existingUser.invite_code });
  }
  
  // 检查活动
  const activity = get('SELECT * FROM activities WHERE id = ?', [activityId]);
  if (!activity) {
    return res.status(404).json({ error: '活动不存在' });
  }
  
  // 时间比较统一用 Asia/Shanghai 时区 (UTC+8)
  // 获取 Railway 服务器的 Asia/Shanghai 当前时间
  const nowUtc = new Date();
  const shanghaiOffset = 8 * 60 * 60 * 1000;
  const now = new Date(nowUtc.getTime() + shanghaiOffset);
  
  // datetime-local 格式不带时区，视为 Asia/Shanghai 本地时间，直接使用即可（Node.js 默认解析为本地时区，而 Railway 容器在 UTC）
  // 由于 Node.js 会把无时区字符串当 UTC 解析，我们先把字符串转为 UTC 基准再处理
  const toShanghaiTime = (dtStr) => {
    if (!dtStr) return null;
    // datetime-local 视为 Asia/Shanghai 本地时间。Date.parse 把无时区字符串当 UTC 解析，
    // 所以减 8h 才能得到真实的本地时间（再转回 UTC 比较时自动抵消）
    return new Date(Date.parse(dtStr) - shanghaiOffset);
  };
  const signinStartTime = toShanghaiTime(activity.signin_start_time);
  const signinEndTime = toShanghaiTime(activity.signin_end_time);
  
  if (signinStartTime && signinEndTime && (now < signinStartTime || now > signinEndTime)) {
    console.log(`[签到时间检查] now=${now.toISOString()}, start=${signinStartTime.toISOString()}, end=${signinEndTime.toISOString()}`);
    return res.status(400).json({ error: '不在签到时间范围内' });
  }
  
  // 生成4位随机邀请码
  let inviteCode;
  let attempts = 0;
  do {
    inviteCode = Math.floor(1000 + Math.random() * 9000).toString();
    const existingCode = get('SELECT id FROM users WHERE invite_code = ?', [inviteCode]);
    if (!existingCode) break;
    attempts++;
  } while (attempts < 100);
  
  if (attempts >= 100) {
    return res.status(500).json({ error: '生成邀请码失败，请重试' });
  }
  
  // 保存签到信息
  const result = run(`
    INSERT INTO users (activity_id, openid, nickname, avatar, real_name, invite_code)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [activityId, openid, nickname, avatar, realName, inviteCode]);
  
  // 获取新用户信息
  const newUser = get('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);
  
  // 实时推送
  io.emit('user-signed-in', { activityId, user: newUser });
  
  // 生成投票链接
  const baseUrl = req.protocol + '://' + req.get('host');
  const voteUrl = `${baseUrl}/user/vote.html?activityId=${activityId}&code=${inviteCode}`;
  
  res.json({ 
    success: true, 
    inviteCode,
    voteUrl,
    message: '签到成功！请使用邀请码进行投票'
  });
});

// 获取签到用户列表
app.get('/api/activities/:id/users', (req, res) => {
  const users = query('SELECT id, nickname, avatar, real_name, created_at FROM users WHERE activity_id = ? ORDER BY created_at DESC', [req.params.id]);
  res.json(users);
});

// ==================== 投票接口 ====================

// 获取投票二维码
app.get('/api/activities/:id/vote-qrcode', async (req, res) => {
  const activityId = req.params.id;
  const baseUrl = req.protocol + '://' + req.get('host');
  const voteUrl = `${baseUrl}/user/vote.html?activityId=${activityId}`;
  
  try {
    const qrcodeDataUrl = await QRCode.toDataURL(voteUrl, {
      width: 300,
      margin: 2
    });
    res.json({ qrcode: qrcodeDataUrl, url: voteUrl });
  } catch (err) {
    res.status(500).json({ error: '生成二维码失败' });
  }
});

// 验证邀请码
app.post('/api/verify-code', (req, res) => {
  const { activityId, code } = req.body;
  
  const user = get('SELECT * FROM users WHERE activity_id = ? AND invite_code = ?', [activityId, code]);
  
  if (!user) {
    return res.status(400).json({ valid: false, error: '邀请码无效' });
  }
  
  if (user.invite_code_used) {
    return res.status(400).json({ valid: false, error: '邀请码已使用' });
  }
  
  res.json({ valid: true, userId: user.id });
});

// 投票
app.post('/api/vote', (req, res) => {
  const { activityId, userId, candidateId, inviteCode } = req.body;
  
  // 验证活动
  const activity = get('SELECT * FROM activities WHERE id = ?', [activityId]);
  if (!activity) {
    return res.status(404).json({ error: '活动不存在' });
  }
  
  // 检查投票时间（同样处理时区）
  const nowUtcV = new Date();
  const shanghaiOffsetV = 8 * 60 * 60 * 1000;
  const nowVote = new Date(nowUtcV.getTime() + shanghaiOffsetV);
  const toShanghaiTime2 = (dtStr) => {
    if (!dtStr) return null;
    // datetime-local 视为 Asia/Shanghai 本地时间。Date.parse 把无时区字符串当 UTC 解析，
    // 所以减 8h 才能得到真实的本地时间（再转回 UTC 比较时自动抵消）
    return new Date(Date.parse(dtStr) - shanghaiOffsetV);
  };
  const voteStartTime = toShanghaiTime2(activity.vote_start_time);
  const voteEndTime = toShanghaiTime2(activity.vote_end_time);
  
  if (voteStartTime && voteEndTime && (nowVote < voteStartTime || nowVote > voteEndTime)) {
    return res.status(400).json({ error: '不在投票时间范围内' });
  }
  
  // 验证用户
  const user = get('SELECT * FROM users WHERE id = ? AND activity_id = ? AND invite_code = ?', [userId, activityId, inviteCode]);
  if (!user) {
    return res.status(400).json({ error: '用户信息无效' });
  }
  
  if (user.invite_code_used || user.has_voted) {
    return res.status(400).json({ error: '您已投过票' });
  }
  
  // 验证候选人
  const candidate = get('SELECT * FROM candidates WHERE id = ? AND activity_id = ?', [candidateId, activityId]);
  if (!candidate) {
    return res.status(400).json({ error: '候选人不存在' });
  }
  
  // 投票
  run('UPDATE users SET invite_code_used = 1, has_voted = 1, voted_candidate_id = ? WHERE id = ?', [candidateId, userId]);
  run('UPDATE candidates SET vote_count = vote_count + 1 WHERE id = ?', [candidateId]);
  run('INSERT INTO votes (activity_id, user_id, candidate_id) VALUES (?, ?, ?)', [activityId, userId, candidateId]);
  
  // 获取最新统计
  const candidates = query('SELECT * FROM candidates WHERE activity_id = ? ORDER BY vote_count DESC, id ASC', [activityId]);
  
  // 实时推送
  io.emit('vote-updated', { activityId, candidates });
  
  res.json({ success: true, message: '投票成功！感谢您的参与' });
});

// 获取投票统计
app.get('/api/activities/:id/vote-stats', (req, res) => {
  const activityId = req.params.id;
  
  const candidates = query('SELECT id, name, avatar, award, vote_count FROM candidates WHERE activity_id = ? ORDER BY vote_count DESC, id ASC', [activityId]);
  const totalVotes = candidates.reduce((sum, c) => sum + (c.vote_count || 0), 0);
  
  res.json({ candidates, totalVotes });
});

// ==================== Socket.IO ====================

io.on('connection', (socket) => {
  console.log('客户端连接:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('客户端断开:', socket.id);
  });
});

// ==================== 启动服务器 ====================

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  console.log(`📱 用户签到页面: http://localhost:${PORT}/user/signin.html`);
  console.log(`🗳️ 用户投票页面: http://localhost:${PORT}/user/vote.html`);
  console.log(`🖥️ 大屏展示页面: http://localhost:${PORT}/screen/index.html`);
  console.log(`⚙️ 管理后台页面: http://localhost:${PORT}/admin/index.html`);
});
