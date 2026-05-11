const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

let db = null;
const dataDir = path.join(__dirname, '../data');
const dbPath = path.join(dataDir, 'vote.db');

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('✅ 数据目录已创建:', dataDir);
  }
}

// 初始化数据库
async function initDatabase() {
  ensureDataDir();
  
  try {
    var SQL = await initSqlJs({
      locateFile: (file) => require.resolve('sql.js/dist/' + file)
    });
  } catch (e) {
    console.error('sql.js 加载失败，尝试备用方式:', e.message);
    var SQL = await initSqlJs();
  }
  
  // 尝试加载已有数据库
  if (fs.existsSync(dbPath)) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
      console.log('✅ 数据库加载成功');
    } catch (e) {
      console.warn('⚠️ 数据库文件损坏，创建新数据库:', e.message);
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
    console.log('✅ 新数据库创建成功');
  }
  
  // 创建表
  try {
    db.run(`CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      signin_name TEXT DEFAULT '签到活动',
      vote_name TEXT DEFAULT '投票活动',
      signin_start_time DATETIME,
      signin_end_time DATETIME,
      vote_start_time DATETIME,
      vote_end_time DATETIME,
      -- 签到地点限制
      signin_location_enabled INTEGER DEFAULT 0,
      signin_lat REAL,
      signin_lng REAL,
      signin_radius INTEGER DEFAULT 50,
      -- 投票地点限制
      vote_location_enabled INTEGER DEFAULT 0,
      vote_lat REAL,
      vote_lng REAL,
      vote_radius INTEGER DEFAULT 50,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT,
      award TEXT,
      vote_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (activity_id) REFERENCES activities(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      openid TEXT,
      nickname TEXT,
      avatar TEXT,
      real_name TEXT,
      invite_code TEXT UNIQUE,
      invite_code_used INTEGER DEFAULT 0,
      has_voted INTEGER DEFAULT 0,
      voted_candidate_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (activity_id) REFERENCES activities(id)
    )`);

    // 防止同一 openid 在同一活动中重复签到（表级约束）
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_activity_openid
            ON users(activity_id, openid)`);

    db.run(`CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (activity_id) REFERENCES activities(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id)
    )`);
    
    // 为已有数据库补充地点限制字段（ALTER TABLE 对已存在的列会报错，用 try/catch 吞掉）
    try { db.run(`ALTER TABLE activities ADD COLUMN signin_location_enabled INTEGER DEFAULT 0`); } catch(e) {}
    try { db.run(`ALTER TABLE activities ADD COLUMN signin_lat REAL`); } catch(e) {}
    try { db.run(`ALTER TABLE activities ADD COLUMN signin_lng REAL`); } catch(e) {}
    try { db.run(`ALTER TABLE activities ADD COLUMN signin_radius INTEGER DEFAULT 50`); } catch(e) {}
    try { db.run(`ALTER TABLE activities ADD COLUMN vote_location_enabled INTEGER DEFAULT 0`); } catch(e) {}
    try { db.run(`ALTER TABLE activities ADD COLUMN vote_lat REAL`); } catch(e) {}
    try { db.run(`ALTER TABLE activities ADD COLUMN vote_lng REAL`); } catch(e) {}
    try { db.run(`ALTER TABLE activities ADD COLUMN vote_radius INTEGER DEFAULT 50`); } catch(e) {}
    
    saveDatabase();
    console.log('✅ 数据库表初始化完成');
  } catch (e) {
    console.error('❌ 数据库表创建失败:', e);
    throw e;
  }
}

// 保存数据库到文件
function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    ensureDataDir();
    fs.writeFileSync(dbPath, buffer);
  } catch (e) {
    console.error('❌ 保存数据库失败:', e);
  }
}

// 查询方法
function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row);
    }
    stmt.free();
    return results;
  } catch (e) {
    console.error('Query error:', e);
    return [];
  }
}

// 执行方法
function run(sql, params = []) {
  try {
    db.run(sql, params);
    saveDatabase();
    var result = db.exec("SELECT last_insert_rowid() as id");
    return { 
      lastInsertRowid: result[0]?.values[0]?.[0] || 0,
      changes: db.getRowsModified()
    };
  } catch (e) {
    console.error('Run error:', e);
    throw e;
  }
}

// 获取单条记录
function get(sql, params = []) {
  const results = query(sql, params);
  return results.length > 0 ? results[0] : null;
}

module.exports = { initDatabase, query, run, get, saveDatabase };
