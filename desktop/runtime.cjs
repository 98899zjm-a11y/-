'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');

// One getter, scoped by AsyncLocalStorage, allows separate databases and requests
// to share the compiled business module without sharing their current actor.
const context = new AsyncLocalStorage();
globalThis.__xjyDesktopContext = () => {
  const value = context.getStore();
  if (!value) throw new Error('本机业务上下文尚未建立');
  return value;
};

class LocalD1 {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    const sqlite = this.sqlite;
    let bindings = [];
    const execute = () => {
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) {
        return { success: true, results: statement.all(...bindings).map(row => ({ ...row })), meta: { changes: 0 } };
      }
      const result = statement.run(...bindings);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    };
    return {
      bind(...values) { bindings = values.map(value => value === undefined ? null : value); return this; },
      async first(column) {
        const row = sqlite.prepare(sql).get(...bindings);
        return row ? (column ? row[column] : { ...row }) : null;
      },
      async all() { return execute(); },
      async run() { return execute(); },
      _execute: execute,
    };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      // No async yield inside the transaction: audit changes() belongs to the
      // immediately preceding write even during Promise.all in business code.
      const result = statements.map(statement => statement._execute());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  async exec(sql) { this.sqlite.exec(sql); return { count: 1, duration: 0 }; }
}

class LocalBucket {
  constructor(dataDir) {
    this.directory = path.join(dataDir, 'images');
    this.metadataFile = path.join(this.directory, 'metadata.json');
    fs.mkdirSync(this.directory, { recursive: true });
    this.metadata = fs.existsSync(this.metadataFile) ? JSON.parse(fs.readFileSync(this.metadataFile, 'utf8')) : {};
  }
  filename(key) {
    if (typeof key !== 'string' || !/^images\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key)) throw new Error('图片文件路径无效');
    return path.join(this.directory, key.slice(7));
  }
  saveMetadata() {
    const temporary = this.metadataFile + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.metadata), { mode: 0o600 });
    fs.renameSync(temporary, this.metadataFile);
  }
  async put(key, value, options = {}) {
    const filename = this.filename(key);
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    const temporary = filename + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, filename);
    this.metadata[key] = { httpMetadata: { ...(options.httpMetadata || {}) }, customMetadata: { ...(options.customMetadata || {}) }, size: bytes.byteLength };
    this.saveMetadata();
    return { key, ...this.metadata[key] };
  }
  async head(key) {
    const filename = this.filename(key);
    const metadata = this.metadata[key];
    return metadata && fs.existsSync(filename) ? { key, ...structuredClone(metadata) } : null;
  }
  async get(key) {
    const metadata = await this.head(key);
    if (!metadata) return null;
    const buffer = fs.readFileSync(this.filename(key));
    return { ...metadata, body: new Uint8Array(buffer), async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); } };
  }
  async delete(key) {
    const filename = this.filename(key);
    fs.rmSync(filename, { force: true });
    delete this.metadata[key];
    this.saveMetadata();
  }
}

function migrate(sqlite, migrationDir) {
  const migrations = fs.readdirSync(migrationDir).filter(name => /^\d+_[\w-]+\.sql$/.test(name)).sort();
  if (!migrations.length) throw new Error('程序数据库结构文件缺失，请重新安装');
  sqlite.exec('CREATE TABLE IF NOT EXISTS desktop_migrations(name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)');
  for (const name of migrations) {
    if (sqlite.prepare('SELECT name FROM desktop_migrations WHERE name=?').get(name)) continue;
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(fs.readFileSync(path.join(migrationDir, name), 'utf8'));
      sqlite.prepare('INSERT INTO desktop_migrations(name,applied_at) VALUES(?,?)').run(name, new Date().toISOString());
      sqlite.exec('COMMIT');
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }
  sqlite.exec(`CREATE TABLE IF NOT EXISTS local_accounts (
    staff_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_users(id),
    username TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

function createRuntime({ dataDir, migrationDir }) {
  const directory = path.resolve(dataDir);
  fs.mkdirSync(directory, { recursive: true });
  const sqlite = new DatabaseSync(path.join(directory, 'jewelry.sqlite'));
  try {
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    migrate(sqlite, path.resolve(migrationDir));
    const env = { DB: new LocalD1(sqlite), BUCKET: new LocalBucket(directory) };
    let closed = false;
    return {
      env, dataDir: directory, sqlite,
      withIdentity(identity, fn) { if (closed) throw new Error('本机数据库已关闭'); return context.run({ env, identity }, fn); },
      getIdentity() { const scope = context.getStore(); return scope?.env === env ? scope.identity : null; },
      close() { if (!closed) { closed = true; sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE)'); sqlite.close(); } },
    };
  } catch (error) { sqlite.close(); throw error; }
}

module.exports = { createRuntime, LocalD1, LocalBucket };
