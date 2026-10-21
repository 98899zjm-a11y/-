'use strict';

const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('../../node_modules/esbuild');

let compiled;
async function bridgeCode() {
  if (!compiled) compiled = esbuild.build({
    entryPoints: [path.resolve(__dirname, '../native-bridge.ts')], bundle: true, write: false,
    platform: 'browser', format: 'cjs', target: 'es2022', logLevel: 'silent',
    plugins: [{
      name: 'isolated-native-adapters',
      setup(build) {
        build.onResolve({ filter: /^(?:@capacitor\/(?:core|filesystem|share)|\.\/lan-client)$/ }, args => ({ path: args.path, namespace: 'native-test' }));
        build.onLoad({ filter: /.*/, namespace: 'native-test' }, args => {
          const contents = args.path === '@capacitor/core'
            ? 'export const Capacitor={isNativePlatform:()=>globalThis.__mobileTest.native};export const CapacitorHttp={request:(input)=>globalThis.__mobileTest.httpRequest(input)};'
            : args.path === '@capacitor/filesystem'
              ? 'export const Directory={Cache:"CACHE"};export const Filesystem={writeFile:(input)=>globalThis.__mobileTest.writeFile(input)};'
              : args.path === '@capacitor/share'
                ? 'export const Share={share:(input)=>globalThis.__mobileTest.share(input)};'
                : 'export const createMobileLanClient=(config,transport)=>globalThis.__mobileTest.createClient(config,transport);';
          return { contents, loader: 'js' };
        });
      },
    }],
  }).then(result => result.outputFiles[0].text);
  return compiled;
}

function reply(status, data = {}) { return { ok: status >= 200 && status < 300, status, data }; }
const privateImage = '12345678-1234-4234-8234-123456789abc';
const code = 'AbCdEfGhIjKlMnOpQrStUvWxYz-_0123';
const oldConfig = { host: '192.168.1.20', port: 31831, code };
const newConfig = { host: '192.168.1.21', port: 31831, code };
const configKey = 'xjy-mobile-host-v1';
const pictureBytes = {
  png: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 71]),
  jpg: Buffer.from([255, 216, 255, 224, 0, 255, 128, 0, 17, 34]),
  webp: Buffer.concat([Buffer.from('RIFF'), Buffer.from([8, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from([0, 255, 128, 16])]),
};

async function createBridgeFixture({ saved = oldConfig, location = { href: 'http://localhost/home', origin: 'http://localhost' } } = {}) {
  const clients = [], http = [], writes = [], shares = [], revoked = [], blobs = new Map(), storage = new Map();
  if (saved) storage.set(configKey, JSON.stringify(saved));
  const state = {
    native: true, failStorage: false, nextHttpReply: null,
    async httpRequest(input) { http.push(input); return state.nextHttpReply || { status: 200, url: input.url, data: '{"native":true}' }; },
    async writeFile(input) { writes.push(input); return { uri: 'file:///native-cache/' + input.path }; },
    async share(input) { shares.push(input); },
    createClient(config, transport) {
      const client = {
        config, transport, connected: false, closed: false, dispatches: [], imageCalls: [],
        dispatchHandler: async input => reply(200, input.path === '/auth/login' ? { authenticated: true, user: { id: 'staff-A' } } : { needsSetup: false, authenticated: false }),
        imageHandler: async () => new Response(pictureBytes.png, { status: 200, headers: { 'content-type': 'image/png' } }),
        async dispatch(input) { this.dispatches.push(input); const result = await this.dispatchHandler(input); if (result.status === 503 || result.status === 403) this.connected = false; else this.connected = true; return result; },
        async imageResponse(id) { this.imageCalls.push(id); return this.imageHandler(id); },
        async close() { this.closed = true; this.connected = false; },
      };
      state.configureClient?.(client); clients.push(client); return client;
    },
  };
  class FakeElement extends EventTarget {
    constructor() { super(); this.dataset = {}; }
    querySelectorAll() { return []; }
  }
  class FakeImage extends FakeElement {
    constructor() { super(); this._src = ''; this.loading = ''; }
    get src() { return this._src; }
    set src(value) { this._src = String(value); }
    getAttribute(name) { return name === 'src' ? this._src : null; }
  }
  const intersections = [], mutations = [];
  class FakeIntersectionObserver {
    constructor(callback) { this.callback = callback; this.observed = new Set(); intersections.push(this); }
    observe(image) { this.observed.add(image); }
    unobserve(image) { this.observed.delete(image); }
    disconnect() { this.observed.clear(); }
  }
  class FakeMutationObserver { constructor(callback) { this.callback = callback; mutations.push(this); } observe() {} disconnect() {} }
  class FixtureURL extends URL {
    static createObjectURL(blob) { const source = 'blob:http://localhost/native-test-' + (blobs.size + 1); blobs.set(source, blob); return source; }
    static revokeObjectURL(source) { revoked.push(source); }
  }
  const window = new EventTarget(); window.location = { ...location };
  const context = vm.createContext({
    __mobileTest: state, module: { exports: {} }, exports: {}, window,
    document: { documentElement: new FakeElement() }, HTMLImageElement: FakeImage, Element: FakeElement,
    IntersectionObserver: FakeIntersectionObserver, MutationObserver: FakeMutationObserver,
    localStorage: { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key), setItem: (key, value) => { if (state.failStorage) throw new Error('fixture storage full'); storage.set(key, value); } },
    URL: FixtureURL, Event, CustomEvent, Response, Headers, Blob, TextEncoder, TextDecoder, atob, btoa,
    crypto: globalThis.crypto, setTimeout, clearTimeout, console,
  });
  vm.runInContext(await bridgeCode(), context, { filename: 'native-bridge-under-test.cjs' });
  await context.module.exports.installMobileBridge();
  const authEvents = []; window.addEventListener('desktop-auth-lost', event => authEvents.push(event));
  return { state, clients, http, writes, shares, revoked, blobs, storage, window, bridge: window.jewelryDesktop, newImage: () => new FakeImage(), intersections, mutations, authEvents };
}

async function settle() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); }
module.exports = { createBridgeFixture, reply, privateImage, code, configKey, oldConfig, newConfig, pictureBytes, settle };
