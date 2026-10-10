import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

// Runs the actual API functions against SQLite and an in-memory R2 adapter.
// Only platform identity/storage imports are replaced; business logic is unchanged.
class TestD1 {
  sqlite = new DatabaseSync(':memory:');
  prepare(sql: string) {
    const sqlite = this.sqlite;
    let bindings: (string | number | null)[] = [];
    return {
      bind(...values: (string | number | null)[]) { bindings = values; return this; },
      async first() { return sqlite.prepare(sql).get(...bindings) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
      async run() { const result = sqlite.prepare(sql).run(...bindings); return { meta: { changes: Number(result.changes) } }; },
    };
  }
  async batch(statements: { run(): Promise<unknown> }[]) {
    this.sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.run()); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}
type StoredObject = { body: Uint8Array; customMetadata: Record<string, string> };
class TestR2 {
  values = new Map<string, StoredObject>();
  async put(key: string, bytes: Uint8Array, options: { customMetadata: Record<string, string> }) { this.values.set(key, { body: bytes, customMetadata: options.customMetadata }); }
  async head(key: string) { return this.values.get(key) || null; }
  async get(key: string) { return this.values.get(key) || null; }
  async delete(key: string) { this.values.delete(key); }
}

test('真实服务端：跨员工隔离、默认价审计、历史版本和原图不可覆盖', async () => {
  const db = new TestD1(), storage = new TestR2();
  const migrations = readdirSync(resolve('drizzle')).filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.length > 0, '需要实际数据库迁移');
  for (const migration of migrations) db.sqlite.exec(readFileSync(resolve('drizzle', migration), 'utf8'));
  const context = { env: { DB: db, BUCKET: storage }, identity: { userId: 'admin-identity', email: 'admin@test.invalid', displayName: '管理员' } };
  const key = '__jewelryReviewContext';
  (globalThis as unknown as Record<string, unknown>)[key] = context;
  let source = readFileSync(resolve('lib/server.ts'), 'utf8');
  source = source.replace('import { env } from "cloudflare:workers";', `const {env} = globalThis.${key};`)
    .replace('import { getChatGPTUser } from "@/app/chatgpt-auth";', `const getChatGPTUser = async () => globalThis.${key}.identity;`)
    .replace('from "./domain";', `from ${JSON.stringify(pathToFileURL(resolve('lib/domain.ts')).href)};`)
    .replace('from "zod";', `from ${JSON.stringify(import.meta.resolve('zod'))};`);
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText + '\n//# sourceURL=jewelry-server-under-review.mjs';
  const api = await import('data:text/javascript;base64,' + Buffer.from(script).toString('base64'));
  const request = (input: unknown) => new Request('http://127.0.0.1/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1' }, body: JSON.stringify(input) });
  const setIdentity = (id: string) => { context.identity = { userId: `${id}-identity`, email: `${id}@test.invalid`, displayName: id }; };
  const rejectStatus = async (status: number, fn: () => Promise<unknown>) => assert.rejects(fn, (error: unknown) => error instanceof api.ApiError && (error as { status: number }).status === status);
  try {
    const admin = (await api.bootstrap()).user;
    assert.equal(admin.role, 'admin');
    const a = (await api.inviteUser(request({ email: 'employee-a@test.invalid', name: '员工A' }))).user;
    const b = (await api.inviteUser(request({ email: 'employee-b@test.invalid', name: '员工B' }))).user;
    setIdentity('employee-a');
    const customerA = (await api.createCustomer(request({ name: '客户A', phone: '13800000000' }))).customer;
    const saleInput = { type: 'sale', customerId: customerA.id, title: '测试戒指', material: 'Pt950', weight: 3.2, goldPrice: 460, laborPrice: 80, extras: [{ id: 'stone', name: '钻石附加费', amount: 900 }, { id: 'accessory', name: '配件', amount: 150 }], discountType: 'amount', discountValue: 200, total: 1, ownerId: b.id };
    const first = (await api.createQuote(request(saleInput))).quote;
    assert.equal(first.ownerId, a.id);
    assert.equal(first.total, 2578);
    assert.equal(first.snapshot.calculation.total, 2578);
    const before = JSON.stringify(first.snapshot);
    const logged = (await api.getQuote(first.id)).logs;
    const override = logged.find((entry: { action: string; newValue: { field?: string } }) => entry.action === 'default-price-override' && entry.newValue?.field === 'goldPrice');
    assert.equal(override.oldValue.value, 450);
    assert.equal(override.oldValue.source, 'company-default');
    assert.equal(override.newValue.value, 460);
    assert.equal(override.actorId, a.id);
    assert.ok(override.createdAt);
    await rejectStatus(403, () => api.updateSettings(request({ sale: { goldPrice: 999, laborPrice: 999 } })));
    await rejectStatus(403, () => api.inviteUser(request({ email: 'illegal@test.invalid', role: 'admin' })));
    await rejectStatus(403, () => api.createStyle(request({ name: '非法款式' })));
    assert.equal((await api.bootstrap()).settings.sale.goldPrice, 450);

    setIdentity('employee-b');
    const customerB = (await api.createCustomer(request({ name: '客户B' }))).customer;
    const privateB = (await api.createQuote(request({ ...saleInput, customerId: customerB.id }))).quote;
    const bootstrapB = await api.bootstrap();
    assert.deepEqual(bootstrapB.customers.map((value: { id: string }) => value.id), [customerB.id]);
    assert.deepEqual(bootstrapB.quotes.map((value: { id: string }) => value.id), [privateB.id]);
    assert.equal(bootstrapB.users.length, 0);
    await rejectStatus(404, () => api.getQuote(first.id));
    await rejectStatus(404, () => api.updateCustomer(request({ id: customerA.id, name: '越权修改' })));
    await rejectStatus(404, () => api.createQuote(request({ ...saleInput, customerId: customerA.id })));
    await rejectStatus(404, () => api.createQuote(request({ ...saleInput, customerId: customerB.id, baseQuoteId: first.id })));

    setIdentity('admin');
    const adminBootstrap = await api.bootstrap();
    assert.equal(adminBootstrap.customers.length, 2);
    assert.equal(adminBootstrap.quotes.length, 2);
    await api.updateSettings(request({ brand: { name: '新的品牌' }, sale: { goldPrice: 900 } }));
    await api.updateCustomer(request({ id: customerA.id, name: '客户A改名' }));
    assert.deepEqual((await api.getQuote(first.id)).quote.snapshot, JSON.parse(before));
    await rejectStatus(400, () => api.createQuote(request({ ...saleInput, customerId: customerB.id, baseQuoteId: first.id })));

    setIdentity('employee-a');
    const second = (await api.createQuote(request({ ...saleInput, weight: 4, baseQuoteId: first.id }))).quote;
    assert.equal(second.rootId, first.rootId);
    assert.equal(second.version, 2);
    assert.equal(second.baseQuoteId, first.id);
    assert.equal(second.ownerId, a.id);
    assert.equal(second.total, 3010);
    assert.deepEqual((await api.getQuote(first.id)).quote.snapshot, JSON.parse(before));
    const versionLog = (await api.getQuote(second.id)).logs.find((entry: { action: string }) => entry.action === 'new-version');
    assert.equal(versionLog.oldValue.snapshot.weight, 3.2);
    assert.equal(versionLog.newValue.snapshot.weight, 4);
    assert.equal(versionLog.actorId, a.id);
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(24).fill(0)]);
    const png = 'data:image/png;base64,' + Buffer.from(bytes).toString('base64');
    const withImage = (await api.attachQuoteImages(request({ images: [png] }), first.id)).quote;
    const imageId = withImage.images[0].split('/').pop();
    assert.equal(withImage.number, first.number);
    assert.equal(storage.values.get('images/' + imageId)?.customMetadata.quoteId, first.id);
    assert.equal((await api.getImage(imageId)).status, 200);
    const imageRouteResponse = await api.api(async () => api.getImage(imageId));
    assert.equal(imageRouteResponse.headers.get('Content-Type'), 'image/png');
    assert.equal(imageRouteResponse.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(new Uint8Array(await imageRouteResponse.arrayBuffer()), bytes);
    await rejectStatus(409, () => api.attachQuoteImages(request({ images: [png] }), first.id));
    const afterImage = (await api.getQuote(first.id)).quote;
    assert.deepEqual(afterImage.snapshot, JSON.parse(before));
    assert.deepEqual(afterImage.images, withImage.images);
    setIdentity('employee-b');
    await rejectStatus(404, () => api.getImage(imageId));
    await rejectStatus(404, () => api.attachQuoteImages(request({ images: [png] }), first.id));
    setIdentity('admin');
    assert.equal((await api.getImage(imageId)).status, 200);
    const adminQuote = (await api.createQuote(request(saleInput))).quote;
    const adminImageQuote = (await api.attachQuoteImages(request({ images: [png] }), adminQuote.id)).quote;
    const sharedImage = adminImageQuote.images[0], sharedImageId = sharedImage.split('/').pop();
    const style = (await api.createStyle(request({ name: '共享款式', image: sharedImage, weight: 3.2 }))).style;
    setIdentity('employee-a');
    assert.equal((await api.getImage(sharedImageId)).status, 200);
    const sharedQuote = (await api.createQuote(request({ ...saleInput, image: sharedImage }))).quote;
    assert.equal(sharedQuote.snapshot.image, sharedImage);
    setIdentity('admin');
    await api.updateStyle(request({ id: style.id, active: false }));
    setIdentity('employee-a');
    assert.equal((await api.getImage(sharedImageId)).status, 200, '停用共享款式不能撤销员工历史报价照片权限');
    assert.equal((await api.createQuote(request({ ...saleInput, image: sharedImage, baseQuoteId: sharedQuote.id }))).quote.version, 2);
    setIdentity('employee-b');
    await rejectStatus(404, () => api.getImage(sharedImageId));
    await rejectStatus(404, () => api.createQuote(request({ ...saleInput, customerId: customerB.id, image: sharedImage })));
    setIdentity('employee-a');
    const recycling = (await api.createQuote(request({ ...saleInput, type: 'recycling', material: 'platinum', goldPrice: 450, recyclingCoefficient: 0.94 }))).quote;
    assert.equal(recycling.snapshot.recyclingName, 'Pt950铂金');
    setIdentity('admin');
    const currentSettings = (await api.bootstrap()).settings;
    await api.updateSettings(request({ recycling: currentSettings.recycling.map((metal: { id: string; name: string }) => ({ ...metal, name: metal.id === 'platinum' ? '改名后的铂金' : metal.name })) }));
    assert.equal((await api.getQuote(recycling.id)).quote.snapshot.recyclingName, 'Pt950铂金');
    assert.equal((await api.getQuote(recycling.id)).quote.total, 1353.6);
    await api.updateUser(request({ id: b.id, active: false }));
    setIdentity('employee-b');
    await rejectStatus(403, () => api.bootstrap());
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM quotes WHERE owner_id=?').get(b.id)?.count, 1);
  } finally {
    delete (globalThis as unknown as Record<string, unknown>)[key];
    db.sqlite.close();
  }
});

test('新增服务端：员工收款设置隔离、共享图库权限和多商品快照', async () => {
  const db = new TestD1(), storage = new TestR2();
  for (const migration of readdirSync(resolve('drizzle')).filter(name => name.endsWith('.sql')).sort()) db.sqlite.exec(readFileSync(resolve('drizzle', migration), 'utf8'));
  const context = { env: { DB: db, BUCKET: storage }, identity: { userId: 'owner-new', email: 'owner-new@test.invalid', displayName: '管理员' } };
  const key = '__jewelryNewModulesContext';
  (globalThis as unknown as Record<string, unknown>)[key] = context;
  let source = readFileSync(resolve('lib/server.ts'), 'utf8');
  source = source.replace('import { env } from "cloudflare:workers";', 'const {env} = globalThis.' + key + ';')
    .replace('import { getChatGPTUser } from "@/app/chatgpt-auth";', 'const getChatGPTUser = async () => globalThis.' + key + '.identity;')
    .replace('from "./domain";', 'from ' + JSON.stringify(pathToFileURL(resolve('lib/domain.ts')).href) + ';')
    .replace('from "zod";', 'from ' + JSON.stringify(import.meta.resolve('zod')) + ';');
  const script = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const api = await import('data:text/javascript;base64,' + Buffer.from(script).toString('base64'));
  const request = (input: unknown) => new Request('http://127.0.0.1/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1' }, body: JSON.stringify(input) });
  const identity = (name: string) => { context.identity = { userId: name + '-new', email: name + '-new@test.invalid', displayName: name }; };
  const noAccess = async (fn: () => Promise<unknown>) => assert.rejects(fn, (error: unknown) => error instanceof api.ApiError && [403, 404].includes((error as { status: number }).status));
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  try {
    const admin = (await api.bootstrap()).user;
    const a = (await api.inviteUser(request({ email: 'a-new@test.invalid', name: '员工A' }))).user;
    const b = (await api.inviteUser(request({ email: 'b-new@test.invalid', name: '员工B' }))).user;
    const companyPayment = [{ id: 'company', name: '公司银行转账', details: '公司收款账号', image: '' }];
    await api.updateSettings(request({ paymentMethods: companyPayment, home: { announcements: '新的工作室公告' }, tradeIn: { depreciationPrice: 20 } }));
    identity('a');
    assert.equal((await api.getPreferences()).inherited, true);
    assert.deepEqual((await api.bootstrap()).paymentMethods, companyPayment);
    const personalPayment = [{ id: 'cash', name: '门店收款', details: '请核对收款方', image: '' }];
    await api.updatePreferences(request({ paymentMethods: personalPayment }));
    assert.deepEqual((await api.getPreferences()).paymentMethods, personalPayment);
    await noAccess(() => api.updateSettings(request({ home: { announcements: '员工不能写全公司公告' } })));
    const shared = (await api.createMedia(request({ name: '共享戒指照片', category: '戒指', image: png }))).asset;
    assert.equal(shared.ownerId, a.id);
    assert.equal((await api.getImage(shared.id)).status, 200);
    identity('b');
    assert.deepEqual((await api.getPreferences()).paymentMethods, companyPayment);
    assert.ok((await api.getMedia()).media.some((asset: { id: string }) => asset.id === shared.id));
    assert.equal((await api.getImage(shared.id)).status, 200, '共享图库图片供其他在职员工选用');
    await noAccess(() => api.updateMedia(request({ id: shared.id, name: '越权编辑' })));
    const customerB = (await api.createCustomer(request({ name: '客户B' }))).customer;
    const input = { type: 'sale', customerId: customerB.id, title: '多件珠宝报价', weight: 0, paymentMethods: companyPayment, discountType: 'amount', discountValue: 200, saleItems: [
      { id: 'one', title: '黄金戒指', material: '足金', specs: '14号', image: shared.url, weight: 2, goldPrice: 500, laborPrice: 50, extras: [{ id: 'stone', name: '配件', amount: 100 }], quantity: 2 },
      { id: 'two', title: '铂金项链', material: 'Pt950', specs: '45cm', image: shared.url, weight: 3, goldPrice: 300, laborPrice: 80, extras: [], quantity: 1 },
    ] };
    const multi = (await api.createQuote(request(input))).quote;
    assert.equal(multi.total, 3340);
    assert.equal(multi.snapshot.saleItems.length, 2);
    assert.deepEqual(multi.snapshot.paymentMethods, companyPayment);
    const original = JSON.stringify(multi.snapshot);
    identity('a');
    const customerA = (await api.createCustomer(request({ name: '客户A' }))).customer;
    const privateQuote = (await api.createQuote(request({ ...input, customerId: customerA.id, saleItems: [{ ...input.saleItems[0], image: '' }], paymentMethods: personalPayment }))).quote;
    const withImage = (await api.attachQuoteImages(request({ images: [png] }), privateQuote.id)).quote;
    identity('b');
    await noAccess(() => api.createQuote(request({ ...input, saleItems: [{ ...input.saleItems[0], image: withImage.images[0] }] })));
    identity('owner');
    assert.equal((await api.bootstrap()).user.id, admin.id);
    await api.updateSettings(request({ paymentMethods: [{ ...companyPayment[0], details: '变更后的公司账号' }], sale: { goldPrice: 999 } }));
    await api.updateMedia(request({ id: shared.id, active: false }));
    assert.equal((await api.getImage(shared.id)).status, 200, '停用素材仍保留历史图像');
    identity('b');
    assert.deepEqual((await api.getQuote(multi.id)).quote.snapshot, JSON.parse(original), '默认价及收款方式变化不影响旧报价');
    assert.equal((await api.getImage(shared.id)).status, 200);
    identity('a');
    assert.deepEqual((await api.getPreferences()).paymentMethods, personalPayment, '公司改默认不覆盖员工已设置的收款方式');
    await api.updatePreferences(request({ paymentMethods: null }));
    assert.equal((await api.getPreferences()).inherited, true);
    assert.equal((await api.getPreferences()).paymentMethods[0].details, '变更后的公司账号');
    identity('owner');
    await api.updateUser(request({ id: b.id, active: false }));
    identity('b');
    await noAccess(() => api.getMedia());
    await noAccess(() => api.getImage(shared.id));
  } finally { delete (globalThis as unknown as Record<string, unknown>)[key]; db.sqlite.close(); }
});
