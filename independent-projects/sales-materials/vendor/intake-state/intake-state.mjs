import { createHash } from 'node:crypto';

// Internal orchestration only. The host must own classify and validate upload receipts.
// Neither this module nor a model decision is an authorization or authenticity proof.
export function createIntakeMachine({ classify } = {}) {
  const tasks = new Map();
  const current = task => {
    if (!task || tasks.get(task.taskId) !== task) throw new Error('invalid or stale snapshot');
    return task;
  };
  const requireState = (task, allowed) => {
    current(task);
    if (!allowed.includes(task.state)) throw new Error('invalid state transition');
  };
  const save = task => {
    const value = Object.freeze(task);
    tasks.set(value.taskId, value);
    return value;
  };
  const validText = text => typeof text === 'string' && text.trim().length > 0 && text.length <= 200;
  const validHash = hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
  return Object.freeze({
    create(input) {
      if (!input || !validText(input.taskId) || !validText(input.scopeId) || !validText(input.deviceId) || !validHash(input.sha256)) throw new Error('invalid task identity');
      const { taskId, scopeId, deviceId, sha256 } = input;
      if (tasks.has(taskId)) throw new Error('task already exists');
      const idempotencyKey = createHash('sha256').update(JSON.stringify(['intake-v1', scopeId, deviceId, taskId, sha256])).digest('hex');
      return save({ taskId, scopeId, deviceId, sha256, idempotencyKey, state: 'discovered', attempts: 0 });
    },
    async evaluate(task) {
      requireState(task, ['discovered', 'awaiting_model', 'needs_review']);
      const evaluating = save({ ...task, state: 'evaluating' });
      try {
        const result = typeof classify === 'function' ? await classify(Object.freeze({ taskId: task.taskId, sha256: task.sha256 })) : null;
        // Adapters are trusted code, but malformed getters must not strand a task.
        const resultHash = result?.sha256;
        const decision = result?.decision;
        if (resultHash !== task.sha256 || !['jewelry', 'not_jewelry', 'uncertain'].includes(decision)) {
          return save({ ...evaluating, state: 'awaiting_model' });
        }
        const state = { jewelry: 'ready', not_jewelry: 'skipped', uncertain: 'needs_review' }[decision];
        return save({ ...evaluating, state });
      } catch {
        return save({ ...evaluating, state: 'awaiting_model' });
      }
    },
    startUpload(task) {
      requireState(task, ['ready', 'retry_upload']);
      return save({ ...task, state: 'uploading', attempts: task.attempts + 1 });
    },
    failUpload(task) {
      requireState(task, ['uploading']);
      return save({ ...task, state: 'retry_upload' });
    },
    completeUpload(task, receipt) {
      requireState(task, ['uploading']);
      if (!receipt || receipt.status !== 'committed' || receipt.taskId !== task.taskId || receipt.sha256 !== task.sha256 || receipt.idempotencyKey !== task.idempotencyKey || !validText(receipt.assetId)) throw new Error('invalid upload receipt');
      return save({ ...task, state: 'imported', assetId: receipt.assetId });
    },
  });
}
