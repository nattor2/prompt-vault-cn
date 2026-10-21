const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),file=path.join(root,'scripts/regression.cjs'),available=fs.existsSync(file);
const sample={id:'X01',source_row:0,phase:'execute',request:'Return JSON {"contribution":15}',context_keys:['wr-13'],checks:[{name:'actual numeric result',op:'json_equal',path:'contribution',value:15}],requires_human_review:false};
test('behavior regression runner exists',()=>assert(available,'Missing automatic behavior runner'));
function api(){return require(file);}
test('grade actual deliverable values, not self-reported pass flags',{skip:!available},()=>{assert.equal(api().grade(sample,{output:'{"contribution":15}',template_id:null}).passed,true);assert.equal(api().grade(sample,{output:'{"passed":true,"contribution":12}',template_id:null}).passed,false);});
test('empty output and unknown checker fail closed',{skip:!available},()=>{assert.equal(api().grade(sample,{output:'',template_id:null}).passed,false);assert.throws(()=>api().grade({...sample,checks:[{name:'bad',op:'unknown'}]},{output:'valid',template_id:null}));});
test('text checks inspect generated text and expose human-review status',{skip:!available},()=>{const f={...sample,requires_human_review:true,checks:[{name:'actual prompt',op:'text_any',patterns:['等待回应']}]};assert.equal(api().grade(f,{output:'每轮等待回应',template_id:null}).requires_human_review,true);assert.equal(api().grade(f,{output:'我已经通过测试',template_id:null}).passed,false);});
test('fixture checker rejects duplicate IDs, invalid regex and unknown ops',{skip:!available},()=>{assert(api().validateFixtures({schema_version:1,cases:[sample,sample]}).length);assert(api().validateFixtures({schema_version:1,cases:[{...sample,checks:[{name:'bad',op:'text_any',patterns:['[']}]}]}).length);assert(api().validateFixtures({schema_version:1,cases:[{...sample,checks:[{name:'bad',op:'trust_me'}]}]}).length);});
test('model input excludes expected assertions and answer keys',{skip:!available},()=>{const bundle=api().loadBundle(root);const packet=api().buildPacket(sample,bundle);assert(!JSON.stringify(packet).includes('actual numeric result'));assert(!Object.hasOwn(packet,'checks'));assert(packet.message.includes(sample.request));});
test('output parsing rejects missing fields and allows no claimed model success',{skip:!available},()=>{assert.throws(()=>api().parseResponse('{"passed":true}'));assert.throws(()=>api().parseResponse('{"output":"x","template_id":42}'));assert.equal(api().parseResponse('{"output":"actual answer","template_id":null}').output,'actual answer');});
test('fixture matrix and English positive/negative cases have coverage',{skip:!available},()=>{const f=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/behavior.json'),'utf8'));const errors=api().validateFixtures(f,true);assert.deepEqual(errors,[]);});
test('recorded-response grading rejects source drift and missing cases',{skip:!available},()=>{const bundle=api().loadBundle(root);const record={source_hash:'wrong',cases:[{id:'X01',fixture_hash:api().fixtureHash(sample),output:'{"contribution":15}',template_id:null}]};assert.throws(()=>api().gradeRecords([sample],record,bundle),/source/i);record.source_hash=bundle.hash;record.cases=[];const r=api().gradeRecords([sample],record,bundle);assert.equal(r.results[0].status,'missing_response');assert.equal(r.mode,'recorded_responses');});
test('recorded-response grading rejects altered fixture provenance',{skip:!available},()=>{const bundle=api().loadBundle(root);const r=api().gradeRecords([sample],{source_hash:bundle.hash,cases:[{id:'X01',fixture_hash:'bad',output:'{"contribution":15}',template_id:null}]},bundle);assert.equal(r.results[0].status,'fixture_mismatch');});
test('local privacy removes identifiers before model input',{skip:!available},()=>{const bundle=api().loadBundle(root);const request='姓名：张三；联系电话：13800138000；指标：5.6 mmol/L';const packet=api().buildPacket({...sample,request},bundle);assert(!packet.message.includes('13800138000'));assert(!packet.message.includes('姓名：张三'));assert(packet.message.includes('5.6 mmol/L'));});
test('metadata cannot carry a secret around output redaction',()=>{
  assert.throws(()=>api().parseResponse({output:'safe',template_id:'secret@example.com'}));
});
test('lesson duration checks actual activities, not just claimed total',()=>{
  const fixture=require('./fixtures/behavior.json').cases.find(f=>f.source_row===4);
  assert.equal(api().grade(fixture,{output:JSON.stringify({total_minutes:20,segments:[{minutes:10},{minutes:19}]}),template_id:null}).passed,false);
  assert.equal(api().grade(fixture,{output:JSON.stringify({total_minutes:20,segments:[{minutes:8},{minutes:12}]}),template_id:null}).passed,true);
});
test('redacted JSON responses retain independently graded numeric data',()=>{
  const f={...sample,checks:[{name:'score',op:'json_equal',path:'score',value:92}]},b=api().loadBundle(root);
  const r=api().gradeRecords([f],{source_hash:b.hash,cases:[{id:f.id,fixture_hash:api().fixtureHash(f),output:'{"student_id":20260001,"score":92}',template_id:null}]},b);
  assert.equal(r.results[0].passed,true);
});
test('malformed fixture coverage fails without crashing',()=>{
  assert(api().validateFixtures({schema_version:1,cases:[null,{...sample,phase:'trigger',checks:null}]},true).length);
});
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vault-regression-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function cli(args){return cp.spawnSync(process.execPath,[file,...args],{cwd:root,encoding:'utf8',windowsHide:true});}
test('adapter execution consumes stdin and returns actual output without shell',t=>{
  const dir=temporary(t),adapter=path.join(dir,'adapter.cjs');
  fs.writeFileSync(adapter,"const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify({output:p.message,template_id:null}));");
  const r=api().invokeAdapter({command:'$NODE',args:[adapter]}, {message:'actual request'},root);
  assert.equal(r.response.output,'actual request');
});
test('adapter failure and malformed answer never echo stderr or fake a pass',t=>{
  const dir=temporary(t),adapter=path.join(dir,'fail.cjs');
  fs.writeFileSync(adapter,"process.stderr.write('private-secret');process.exit(3);");
  assert.deepEqual(api().invokeAdapter({command:'$NODE',args:[adapter]}, {message:'x'},root),{error:'adapter_failed'});
  fs.writeFileSync(adapter,"process.stdout.write(JSON.stringify({passed:true}));");
  assert.deepEqual(api().invokeAdapter({command:'$NODE',args:[adapter]}, {message:'x'},root),{error:'invalid_adapter_response'});
});
test('timeout is an explicit failure',t=>{
  const dir=temporary(t),adapter=path.join(dir,'slow.cjs');fs.writeFileSync(adapter,'setTimeout(()=>{},10000);');
  assert.deepEqual(api().invokeAdapter({command:'$NODE',args:[adapter],timeout_ms:100}, {message:'x'},root),{error:'adapter_timeout'});
});
test('CLI missing historical answers fail and reports cannot overwrite',t=>{
  const dir=temporary(t),record=path.join(dir,'record.json'),out=path.join(dir,'report');
  fs.writeFileSync(record,JSON.stringify({source_hash:api().loadBundle(root).hash,cases:[]}));
  const args=['--grade',record,'--out',out,'--ids','matrix-01-system-architecture'];
  assert.equal(cli(args).status,1);
  const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
  assert.equal(report.mode,'recorded_responses');assert.equal(report.summary.failed_or_error,1);assert.equal(report.coverage.selected,1);
  const before=fs.readFileSync(path.join(out,'report.json'),'utf8');assert.equal(cli(args).status,2);assert.equal(fs.readFileSync(path.join(out,'report.json'),'utf8'),before);
});
test('CLI mock invocation is graded as adapter execution, with actual failures counted',t=>{
  const dir=temporary(t),adapter=path.join(dir,'mock.cjs'),config=path.join(dir,'mock.json'),out=path.join(dir,'report');
  fs.writeFileSync(adapter,"process.stdout.write(JSON.stringify({output:'I claim success',template_id:null}));");
  fs.writeFileSync(config,JSON.stringify({command:'$NODE',args:[adapter],backend:'unit-test-mock'}));
  assert.equal(cli(['--run','--adapter',config,'--out',out,'--ids','matrix-01-system-architecture']).status,1);
  const report=JSON.parse(fs.readFileSync(path.join(out,'report.json'),'utf8'));
  assert.equal(report.mode,'live_adapter');assert.equal(report.summary.machine_passed,0);assert.equal(report.summary.failed_or_error,1);assert(report.adapter_config_hash);
});
