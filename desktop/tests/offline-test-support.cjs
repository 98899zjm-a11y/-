'use strict';

function blockNetwork() {
  const attempts = [], restore = [];
  const replace = (object, key, name) => {
    const previous = object[key];
    if (typeof previous !== 'function') return;
    object[key] = function () { attempts.push(name); throw new Error('离线验收禁止网络调用：' + name); };
    restore.push(() => { object[key] = previous; });
  };
  replace(globalThis, 'fetch', 'fetch');
  replace(globalThis, 'WebSocket', 'WebSocket');
  for (const kind of ['http', 'https']) { const module = require('node:' + kind); replace(module, 'request', kind + '.request'); replace(module, 'get', kind + '.get'); }
  const net = require('node:net'); replace(net, 'connect', 'net.connect'); replace(net, 'createConnection', 'net.createConnection'); replace(net.Socket.prototype, 'connect', 'Socket.connect');
  replace(require('node:tls'), 'connect', 'tls.connect');
  return { attempts, restore() { for (const reset of restore.reverse()) reset(); } };
}
module.exports = { blockNetwork };
