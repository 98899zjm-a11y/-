'use strict';

// Interoperability harness only. All deterministic private keys, passwords and
// tokens below are PUBLIC TEST MATERIAL. Never use them in a deployed client.
// This script leaves the delivered desktop application unchanged.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const INFO = Buffer.from('xjy-lan-v1-x25519-aes256gcm', 'utf8');
const projectRoot = path.resolve(__dirname, '../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest();
const pin = spki => sha(spki).subarray(0, 24).toString('base64url');
const aad = direction => Buffer.from('xjy-lan-v1:' + direction, 'utf8');

function privatePair(raw) {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), type: 'pkcs8', format: 'der' });
  const publicKey = crypto.createPublicKey(privateKey), spki = publicKey.export({ type: 'spki', format: 'der' });
  assert.equal(spki.length, 44); assert.deepEqual(spki.subarray(0, 12), SPKI_PREFIX);
  return { privateKey, publicKey, spki };
}
function derive(privateKey, peerSpki, serverSpki, ephemeralSpki) {
  assert.equal(peerSpki.length, 44); assert.deepEqual(peerSpki.subarray(0, 12), SPKI_PREFIX);
  const publicKey = crypto.createPublicKey({ key: peerSpki, type: 'spki', format: 'der' });
  const sharedSecret = crypto.diffieHellman({ privateKey, publicKey });
  const salt = sha(Buffer.concat([serverSpki, ephemeralSpki]));
  const key = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, salt, INFO, 32));
  return { sharedSecret, salt, key };
}
function seal(key, plaintext, direction, iv, publicKey) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad(direction));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ...(publicKey ? { publicKey } : {}), iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') };
}
function open(key, envelope, direction) {
  const value = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64url')); decipher.setAAD(aad(direction)); decipher.setAuthTag(Buffer.from(value.tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64url')), decipher.final()]).toString('utf8');
}
function pngFixture() {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const size = Buffer.alloc(4), tag = Buffer.from(type), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([tag, data]))); return Buffer.concat([size, tag, data, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
}
function generateVectors() {
  const hostRaw = sha(Buffer.from('XJY PUBLIC TEST HOST KEY 2026')), ephemeralRaw = sha(Buffer.from('XJY PUBLIC TEST EPHEMERAL KEY 2026'));
  const host = privatePair(hostRaw), ephemeral = privatePair(ephemeralRaw);
  const { sharedSecret, salt, key } = derive(ephemeral.privateKey, host.spki, host.spki, ephemeral.spki);
  assert.deepEqual(derive(host.privateKey, ephemeral.spki, host.spki, ephemeral.spki).key, key);
  const token = sha(Buffer.from('XJY PUBLIC TEST SESSION TOKEN')).toString('base64url');
  const packet = { id: '00112233-4455-4677-8899-aabbccddeeff', timestamp: 1791592200000, token: null, op: 'request', input: { path: '/auth/login', method: 'POST', body: { username: 'fixture_员工', password: 'PublicFixture-Only-562!' } } };
  const response = { requestId: packet.id, result: { ok: true, status: 200, data: { needsSetup: false, authenticated: true, user: { id: 'fixture-user', username: 'fixture_员工', role: 'employee' } } }, token };
  const requestJson = JSON.stringify(packet), responseJson = JSON.stringify(response);
  const request = seal(key, requestJson, 'request', Buffer.from('000102030405060708090a0b', 'hex'), ephemeral.spki.toString('base64url'));
  const encryptedResponse = seal(key, responseJson, 'response', Buffer.from('101112131415161718191a1b', 'hex'));
  const image = pngFixture(), imageJson = JSON.stringify({ requestId: packet.id, result: { ok: true, status: 200 }, image: { bytes: image.toString('base64'), headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } } });
  const imageEnvelope = seal(key, imageJson, 'response', Buffer.from('202122232425262728292a2b', 'hex'));
  assert.equal(open(key, request, 'request'), requestJson); assert.equal(open(key, encryptedResponse, 'response'), responseJson);
  assert.deepEqual(Buffer.from(JSON.parse(open(key, imageEnvelope, 'response')).image.bytes, 'base64'), image);
  assert.throws(() => open(key, encryptedResponse, 'request'));
  assert.throws(() => open(sha(Buffer.from(pin(host.spki))), request, 'request'));
  const badTag = { ...request, tag: Buffer.alloc(16).toString('base64url') }; assert.throws(() => open(key, badTag, 'request'));
  return {
    warning: 'PUBLIC TEST MATERIAL ONLY. Fixed private keys/IV/password/token MUST NOT be used in production.',
    protocol: { identityPath: '/jewelry-identity', requestPath: '/jewelry-lan', version: 1, base64Envelope: 'base64url without padding', imageBytesBase64: 'standard base64 with padding', x25519SpkiPrefixHex: SPKI_PREFIX.toString('hex'), x25519Pkcs8PrefixHex: PKCS8_PREFIX.toString('hex'), hkdfHash: 'SHA-256', hkdfInfoUtf8: INFO.toString('utf8'), aesKeyBytes: 32, ivBytes: 12, tagBytes: 16, requestAadUtf8: aad('request').toString(), responseAadUtf8: aad('response').toString(), timestampUnit: 'Unix milliseconds', timestampWindowMilliseconds: 300000, replayId: 'fresh lowercase UUID per transport request', maxWireBytes: 67108864 },
    host: { privateRawHex: hostRaw.toString('hex'), publicRawHex: host.spki.subarray(12).toString('hex'), publicSpkiBase64url: host.spki.toString('base64url'), pin: pin(host.spki) },
    ephemeral: { privateRawHex: ephemeralRaw.toString('hex'), publicRawHex: ephemeral.spki.subarray(12).toString('hex'), publicSpkiBase64url: ephemeral.spki.toString('base64url') },
    derivation: { sharedSecretHex: sharedSecret.toString('hex'), saltSha256Hex: salt.toString('hex'), aes256KeyHex: key.toString('hex') },
    request: { plaintextUtf8: requestJson, plaintextUtf8Hex: Buffer.from(requestJson).toString('hex'), envelope: request },
    response: { plaintextUtf8: responseJson, envelope: encryptedResponse },
    imageResponse: { plaintextUtf8: imageJson, envelope: imageEnvelope, imageSha256Hex: sha(image).toString('hex') },
    expectedFailures: { wrongDirectionAad: true, tamperedGcmTag: true, keyDerivedFromPublicPin: true },
  };
}

function validateDestination(host, port) {
  const { isPrivateIPv4 } = require(path.join(projectRoot, 'desktop', 'lan.cjs'));
  if (net.isIP(host) !== 4 || !isPrivateIPv4(host)) throw new Error('联测仅允许局域网 IPv4 地址');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('联测端口无效');
}
function exchange(host, port, method, endpoint, body) {
  validateDestination(host, port);
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const request = http.request({ host, port, method, path: endpoint, family: 4, agent: false, ...(bytes ? { headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length } } : {}) }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 64 * 1024 * 1024) response.destroy(new Error('联测响应超出64MB')); else chunks.push(chunk); });
      response.on('error', reject); response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.setTimeout(5000, () => request.destroy(new Error('联测主机连接超时'))); request.once('error', reject); request.end(bytes);
  });
}
async function createProbe({ host, port = 31831, code }) {
  validateDestination(host, port);
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) throw new Error('请核对联测连接码');
  const result = await exchange(host, port, 'GET', '/jewelry-identity');
  if (result.status !== 200) throw new Error('主机公开身份不可读取');
  const identity = JSON.parse(result.text), serverSpki = Buffer.from(identity.publicKey, 'base64url');
  assert.equal(serverSpki.length, 44); assert.deepEqual(serverSpki.subarray(0, 12), SPKI_PREFIX);
  if (identity.version !== 1 || pin(serverSpki) !== code) throw new Error('主机身份与连接码不一致');
  let token = null;
  async function send(op, input, imageId) {
    const ephemeral = crypto.generateKeyPairSync('x25519'), spki = ephemeral.publicKey.export({ type: 'spki', format: 'der' });
    const key = derive(ephemeral.privateKey, serverSpki, serverSpki, spki).key;
    const packet = { id: crypto.randomUUID(), timestamp: Date.now(), token, op, ...(op === 'image' ? { imageId } : { input }) };
    if (op === 'request' && input.path === '/auth/logout') token = null;
    const response = await exchange(host, port, 'POST', '/jewelry-lan', seal(key, JSON.stringify(packet), 'request', crypto.randomBytes(12), spki.toString('base64url')));
    const decoded = JSON.parse(open(key, response.text, 'response')); assert.equal(decoded.requestId, packet.id);
    if ('token' in decoded) token = decoded.token; if (decoded.result.status === 401) token = null;
    return decoded;
  }
  return { request: async input => (await send('request', input)).result, image: async imageId => send('image', null, imageId) };
}
async function selfTest() {
  const { createBackend } = require(path.join(projectRoot, 'desktop', 'backend.cjs'));
  const { startLanServer } = require(path.join(projectRoot, 'desktop', 'lan.cjs'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xjy-mobile-protocol-'));
  const backend = createBackend({ dataDir, migrationDir: path.join(projectRoot, 'drizzle') });
  const password = 'IsolatedMobileFixture-Password-622!';
  let server;
  try {
    assert.equal((await backend.dispatch({ path: '/auth/setup', method: 'POST', body: { username: 'mobile-fixture', password } })).ok, true);
    server = await startLanServer({ backend, host: '127.0.0.1', port: 0 });
    const probe = await createProbe(server);
    assert.equal((await probe.request({ path: '/auth/status' })).data.authenticated, false);
    assert.equal((await probe.request({ path: '/auth/login', method: 'POST', body: { username: 'mobile-fixture', password } })).data.authenticated, true);
    assert.equal((await probe.request({ path: '/api/bootstrap' })).data.user.username, 'mobile-fixture');
    const customer = (await probe.request({ path: '/api/customers', method: 'POST', body: { name: '手机协议隔离验收' } })).data.customer;
    const quote = (await probe.request({ path: '/api/quotes', method: 'POST', body: { type: 'sale', customerId: customer.id, title: '手机协议验收', material: '黄金', weight: 2, goldPrice: 450, laborPrice: 80 } })).data.quote;
    assert.equal(quote.total, 1060);
    const image = pngFixture();
    const saved = await probe.request({ path: '/api/quotes/' + quote.id + '/images', method: 'POST', body: { images: ['data:image/png;base64,' + image.toString('base64')] } });
    const imageResult = await probe.image(saved.data.quote.images[0].split('/').pop());
    assert.equal(imageResult.result.status, 200); assert.deepEqual(Buffer.from(imageResult.image.bytes, 'base64'), image);
    assert.equal((await probe.request({ path: '/api/../auth/setup', method: 'POST', body: {} })).status, 400);
    assert.equal((await probe.request({ path: '/auth/logout', method: 'POST' })).data.authenticated, false);
    assert.equal((await probe.request({ path: '/api/bootstrap' })).status, 401);
    return { ok: true, checks: ['identity-pin', 'independent-ecdh-hkdf-aead', 'login-token', 'bootstrap', 'customer-quote-save', 'image-original-bytes', 'canonical-route', 'logout'], isolatedTestDataDir: dataDir };
  } finally { await server?.stop(); await backend.close(); }
}
async function main() {
  const vectors = generateVectors();
  const outputIndex = process.argv.indexOf('--out');
  if (outputIndex >= 0) { const file = path.resolve(process.argv[outputIndex + 1]); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(vectors, null, 2)); process.stdout.write('Protocol test vectors saved.\n'); }
  if (process.argv.includes('--self-test')) process.stdout.write(JSON.stringify(await selfTest()) + '\n');
  if (process.argv.includes('--probe')) {
    // Credentials, if needed, enter through stdin and are never printed/written.
    const input = JSON.parse(fs.readFileSync(0, 'utf8')), probe = await createProbe(input);
    const status = await probe.request({ path: '/auth/status' });
    if (input.username && input.password) { const login = await probe.request({ path: '/auth/login', method: 'POST', body: { username: input.username, password: input.password } }); if (!login.ok) throw new Error(login.data.error); }
    const bootstrap = input.username ? await probe.request({ path: '/api/bootstrap' }) : null;
    if (bootstrap && !bootstrap.ok) throw new Error(bootstrap.data.error);
    if (input.username) await probe.request({ path: '/auth/logout', method: 'POST' });
    process.stdout.write(JSON.stringify({ ok: status.ok, identityVerified: true, authenticatedProbe: Boolean(bootstrap?.ok) }) + '\n');
  }
  if (outputIndex < 0 && !process.argv.includes('--self-test') && !process.argv.includes('--probe')) process.stdout.write('Usage: node mobile/tests/protocol-fixtures.cjs --out <json-path> [--self-test]\nLive read-only probe: --probe with {host,port,code,username?,password?} on stdin.\n');
}
module.exports = { generateVectors, createProbe, selfTest };
if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
