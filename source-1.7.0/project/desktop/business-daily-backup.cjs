'use strict';
const path = require('node:path'), crypto = require('node:crypto');

function dayKey(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('Invalid scheduler time');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(x => [x.type, x.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function createBusinessDailyBackups({ service, context, markerName = 'daily-backup.json' }) {
  const { layout, policy, namespace } = require('./business-maintenance-layout.cjs').requireContext(context);
  const fs = policy.io;
  if (!/^daily-backup(?:-test)?\.json$/.test(markerName)) throw new Error('Unknown daily backup marker');
  const marker = policy.check(path.join(layout.configDir, markerName), true);
  let active = null, timer = null, stopping = false, verified = null, cleanupPending = true;
  let lastAttemptAt = null, lastVerifiedAt = null, lastError = null;

  function getStatus(now = new Date()) {
    const day = dayKey(now);
    const state = active ? 'running' : lastError ? 'failed' :
      lastVerifiedAt && dayKey(new Date(lastVerifiedAt)) === day ? 'verified-today' : 'unverified';
    return { version: 1, state, day, lastAttemptAt, lastVerifiedAt, lastError: lastError ? { ...lastError } : null };
  }

  function recordFailure(error) {
    const observed = error?.code;
    const code = ['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'ISOLATION'].includes(observed) ? observed : 'BACKUP_FAILED';
    lastError = { at: lastAttemptAt || new Date().toISOString(), code, message: '自动备份未完成，请稍后重试。' };
  }

  function fingerprint(file) {
    const signature = stat => {
      if (!stat.isFile() || stat.nlink !== 1n) throw new Error('Daily backup must be a regular owned file');
      const fields = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].map(name => stat[name]);
      // Missing physical metadata never earns a reusable validation cache.
      if (!stat.ino || fields.some(value => typeof value !== 'bigint')) return null;
      return fields.join(':');
    };
    const before = signature(fs.statSync(policy.check(file), { bigint: true }));
    if (before === null) return null;
    // Windows can give two immediate same-size writes identical Ns stamps.
    // Read ciphertext only: keep 64KiB bounded memory while avoiding repeated
    // decrypt/extract/SQLite probes. Metadata alone is not content validation.
    const fd = fs.openSync(policy.check(file), 'r'), hash = crypto.createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
    try {
      let count;
      while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    } finally { fs.closeSync(fd); }
    const after = signature(fs.statSync(policy.check(file), { bigint: true }));
    if (before !== after) throw new Error('Daily backup changed during fingerprint read');
    return before + ':' + hash.digest('hex');
  }

  async function verify(file, before = fingerprint(file)) {
    await service.probe(file, { requireCurrentSlots: true });
    const after = fingerprint(file);
    if (before !== after) throw new Error('Daily backup changed during integrity verification');
    // Only the complete probe plus unchanged ciphertext earns a successful
    // timestamp. Retention may still fail later, without erasing this fact.
    if (before !== null && after !== null) lastVerifiedAt = lastAttemptAt;
    return after;
  }

  async function cleanup(now) {
    if (!cleanupPending) return;
    await service.cleanup(now);
    cleanupPending = false;
  }

  function tick(now = new Date()) {
    if (stopping) return Promise.resolve({ created: false, stopped: true });
    if (active) return active;
    active = (async () => {
      const day = dayKey(now);
      lastAttemptAt = now.toISOString();
      if (fs.existsSync(marker)) {
        const old = JSON.parse(fs.readFileSync(marker, 'utf8'));
        if (old.namespace !== namespace || old.version !== 1 || typeof old.file !== 'string') throw new Error('Invalid daily backup state; no fallback');
        // Always run the original guard, even for a warm cache. A cached marker
        // is never permission to read another root, namespace or hardlink.
        policy.check(old.file);
        if (old.day === day && service.list().some(x => x.file === old.file && x.kind === 'auto')) {
          let valid = false;
          try {
            const before = fingerprint(old.file);
            if (before !== null && verified?.day === day && verified.file === old.file && verified.fingerprint === before) valid = true;
            else {
              verified = null;
              const stamp = await verify(old.file, before);
              verified = stamp === null ? null : { day, file: old.file, fingerprint: stamp };
              valid = true;
            }
          } catch (error) {
            verified = null;
            if (['ISOLATION', 'EACCES', 'EPERM'].includes(error?.code)) throw error;
            // Changed/corrupt bytes require a new complete snapshot.
          }
          if (valid) {
            // Keep this outside the probe catch: retention failure must retry
            // retention, not create another full backup on every tick.
            await cleanup(now);
            return { created: false, day };
          }
        }
      }
      verified = null;
      const backup = await service.create({ kind: 'auto', now });
      const stamp = await verify(backup.file);
      const temporary = policy.check(marker + '.' + crypto.randomUUID() + '.tmp', true);
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, namespace, day, file: backup.file, createdAt: backup.createdAt }), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, marker);
      verified = stamp === null ? null : { day, file: backup.file, fingerprint: stamp };
      cleanupPending = true;
      await cleanup(now);
      return { created: true, ...backup, day };
    })().then(result => { lastError = null; return result; }, error => { recordFailure(error); throw error; })
      .finally(() => { active = null; });
    return active;
  }

  return {
    tick,
    getStatus,
    start() {
      if (timer) return;
      timer = setInterval(() => tick().catch(error => {
        try { fs.appendFileSync(path.join(layout.logDir, 'daily-backup-errors.log'), new Date().toISOString() + ' ' + error.message + '\n'); }
        catch { /* A full or inaccessible log volume must not reject the timer. Failed health remains available. */ }
      }), 60000);
      timer.unref();
    },
    async stop() { stopping = true; if (timer) clearInterval(timer); await active?.catch(() => {}); },
  };
}
module.exports = { createBusinessDailyBackups, dayKey };
