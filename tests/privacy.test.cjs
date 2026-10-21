const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const script = path.resolve(__dirname, '../scripts/privacy.cjs');
const exists = fs.existsSync(script);
test('empty sensitive labels cannot consume the following data line',()=>{
  const s='姓名：\n年龄：35 岁；剂量：5 mg';
  assert.equal(require(script).redact(s).text,s);
});
test('Markdown bold labels and table delimiters are recognized',()=>{
  const r=require(script).redact('**姓名**：张三\n**住址**：某市某街8号\n| 姓名：李四 | 成绩：92 |');
  assert(!r.text.includes('张三'));assert(!r.text.includes('某市某街8号'));assert(!r.text.includes('李四'));assert(r.text.includes('成绩：92'));
});
test('numeric JSON identifiers redact to valid JSON without changing grades',()=>{
  const r=JSON.parse(require(script).redact('{"student_id":20260001,"score":92}').text);
  assert.match(r.student_id,/REDACTED_STUDENT_ID/);assert.equal(r.score,92);
});
const api = exists ? require(script) : {};
test('privacy scanner module exists', () => assert(exists, 'Missing scripts/privacy.cjs'));
const check = (name, fn) => test(name, {skip: !exists}, fn);
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vault-privacy-'));
const run = (...args) => cp.spawnSync(process.execPath, [script, ...args], {encoding:'utf8'});
check('findings contain only kind and UTF16 spans, never raw values', () => {
  const s = '联络 a.person@example.test，手机 13800138000，身份证 11010519491231002X，密钥 sk-'+'a'.repeat(40);
  const findings = api.scan(s);
  assert.deepEqual(new Set(findings.map(f=>f.kind)), new Set(['EMAIL','PHONE','ID_CARD','API_TOKEN']));
  for(const f of findings) { assert.deepEqual(Object.keys(f).sort(), ['end','kind','start']); assert(f.end>f.start); }
  assert(!JSON.stringify(findings).includes('example.test'));
});
check('Chinese labels, JSON keys and environment fields are redacted', () => {
  const s = '姓名：张三\n住址：某市某街 8 号\n病历号: MR0009\n学号=20260001\nPASSWORD=synthetic-secret\n{"token":"fake credential", "name":"Alice Smith", "address":"42 Test Road"}';
  const r = api.redact(s);
  for(const value of ['张三','某市某街 8 号','MR0009','20260001','synthetic-secret','fake credential','Alice Smith','42 Test Road']) assert(!r.text.includes(value), value);
  assert.equal(r.manual_review_required,true);
  assert.equal(api.scan(r.text).length,0);
});
check('repeated identical values reuse a placeholder and counts count occurrences', () => {
  const r=api.redact('a@example.test a@example.test b@example.test');
  assert.equal(r.text,'[REDACTED_EMAIL_1] [REDACTED_EMAIL_1] [REDACTED_EMAIL_2]');
  assert.equal(r.counts.EMAIL,3);
});
check('identical values in different labelled fields reuse their first placeholder', () => {
  const r=api.redact('password=shared-synthetic\ntoken=shared-synthetic');
  assert.equal(r.text,'password=[REDACTED_PASSWORD_1]\ntoken=[REDACTED_PASSWORD_1]');
  assert.deepEqual(r.counts,{PASSWORD:1,TOKEN:1});
});
check('redaction is idempotent and existing placeholder numbering is preserved', () => {
  const r=api.redact('[REDACTED_EMAIL_1] a@example.test\n姓名：【必填：匿名患者】\npassword=[REDACTED_PASSWORD_1]');
  assert(r.text.includes('[REDACTED_EMAIL_2]'));
  assert.equal(api.redact(r.text).text,r.text);
});
check('medical units, doses, dates, ages and grades remain byte identical', () => {
  const s='年龄：35 岁；日期：2026-10-20；剂量：5 mg，每日 2 次；血压 120/80 mmHg；体温 37.5 °C；成绩：92 分。';
  assert.equal(api.redact(s).text,s);
});
check('numeric identifier boundaries reject embedded longer numbers', () => {
  assert.deepEqual(api.scan('0138001380009 9911010519491231002X99 abcsk-short 2026-10-20'),[]);
});
check('unlabelled names and street prose are explicitly outside formal detection', () => assert.deepEqual(api.scan('张三走过中山路。Alice visited Test Road.'),[]));
check('check CLI returns exit1 with safe spans and no raw secret', () => {
  const f=path.join(fixture(),'input.txt'); fs.writeFileSync(f,'a@example.test');
  const r=run('--check',f); assert.equal(r.status,1); assert(!r.stdout.includes('a@example.test')); assert(!r.stderr.includes('a@example.test')); assert.equal(JSON.parse(r.stdout).findings.length,1);
});
check('clean check returns exit0 and never writes the input', () => {
  const f=path.join(fixture(),'input.txt'); fs.writeFileSync(f,'剂量 5 mg');
  assert.equal(run('--check',f).status,0); assert.equal(fs.readFileSync(f,'utf8'),'剂量 5 mg');
});
check('redact CLI creates a new clean file and prints only a summary', () => {
  const d=fixture(),f=path.join(d,'in.txt'),out=path.join(d,'out.txt'); fs.writeFileSync(f,'姓名：张三\na@example.test');
  const r=run('--redact',f,'--out',out); assert.equal(r.status,0,r.stderr); assert.equal(api.scan(fs.readFileSync(out,'utf8')).length,0);
  assert(!r.stdout.includes('张三')); assert(!r.stdout.includes('a@example.test')); assert(!JSON.parse(r.stdout).text);
});
check('CLI refuses input overwrite and preexisting output without changes', () => {
  const d=fixture(),f=path.join(d,'in.txt'),out=path.join(d,'out.txt'); fs.writeFileSync(f,'a@example.test'); fs.writeFileSync(out,'keep');
  assert.equal(run('--redact',f,'--out',f).status,2); assert.equal(run('--redact',f,'--out',out).status,2);
  assert.equal(fs.readFileSync(f,'utf8'),'a@example.test'); assert.equal(fs.readFileSync(out,'utf8'),'keep');
});
check('CLI refuses hardlinked inputs and output aliases', () => {
  const d=fixture(),f=path.join(d,'in.txt'),alias=path.join(d,'alias.txt'); fs.writeFileSync(f,'a@example.test'); fs.linkSync(f,alias);
  assert.equal(run('--check',f).status,2); assert.equal(run('--redact',f,'--out',alias).status,2);
});
check('CLI rejects invalid UTF8, binary, missing files and malformed arguments safely', () => {
  const d=fixture(),f=path.join(d,'input.txt'),out=path.join(d,'out.txt');
  for(const bytes of [Buffer.from([0xc3,0x28]),Buffer.from('abc\0def')]) { fs.writeFileSync(f,bytes); assert.equal(run('--redact',f,'--out',out).status,2); assert(!fs.existsSync(out)); }
  for(const args of [[],['--check'],['--wat','secret'],['--check',path.join(d,'absent')]]) {const r=run(...args);assert.equal(r.status,2);assert(!r.stderr.includes(d));}
});
check('symlink inputs and symlinked parent paths are refused when supported', t => {
  const d=fixture(),real=path.join(d,'real'),alias=path.join(d,'alias');fs.mkdirSync(real); const f=path.join(real,'in.txt');fs.writeFileSync(f,'a@example.test');
  try{fs.symlinkSync(real,alias,process.platform==='win32'?'junction':'dir');}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip('OS does not allow symlinks');return;}throw e;}
  assert.equal(run('--check',path.join(alias,'in.txt')).status,2);
  assert.equal(run('--redact',f,'--out',path.join(alias,'out.txt')).status,2);
});
