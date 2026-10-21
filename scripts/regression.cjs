'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const {scan,redact}=require('./privacy.cjs');
const {scanMarkdown}=require('./catalog.cjs');
const DEFAULT_FIXTURE='tests/fixtures/behavior.json';
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const fixtureHash=f=>digest(JSON.stringify(f));
function validateFixtures(data,coverage=false){
  const errors=[],ids=new Set(),rows=new Set();
  if(data?.schema_version!==1||!Array.isArray(data.cases)||!data.cases.length)return ['Invalid fixture set'];
  for(const f of data.cases){
    if(!f||typeof f.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(f.id)||ids.has(f.id))errors.push('Invalid or duplicate fixture ID');ids.add(f?.id);
    if(!['trigger','generate','execute'].includes(f?.phase))errors.push(`${f?.id}: invalid phase`);
    if(!Number.isInteger(f?.source_row)||f.source_row<0||f.source_row>18)errors.push(`${f?.id}: invalid source row`);else rows.add(f.source_row);
    if(typeof f?.request!=='string'||!f.request.trim()||!Array.isArray(f.context_keys)||!f.context_keys.every(x=>typeof x==='string')||typeof f.requires_human_review!=='boolean')errors.push(`${f?.id}: invalid input/context/review requirement`);
    if(!Array.isArray(f?.checks)||!f.checks.length){errors.push(`${f?.id}: missing checks`);continue;}
    for(const c of f.checks){
      if(!c||typeof c.name!=='string'||!c.name.trim())errors.push(`${f?.id}: unnamed check`);
      if(['text_any','text_none'].includes(c?.op)){
        if(!Array.isArray(c.patterns)||!c.patterns.length||!c.patterns.every(x=>typeof x==='string'))errors.push(`${f.id}: invalid text patterns`);
        else for(const p of c.patterns){try{new RegExp(p,'iu');}catch{errors.push(`${f.id}: invalid regex`);}}
      }else if(c?.op==='template_in'){
        if(!Array.isArray(c.values)||!c.values.length||!c.values.every(x=>typeof x==='string'))errors.push(`${f.id}: invalid template check`);
      }else if(['json_equal','json_close','json_sum'].includes(c?.op)){
        if(typeof c.path!=='string'||!/^\w+(?:\.\w+)*$/.test(c.path)||!Object.hasOwn(c,'value'))errors.push(`${f.id}: invalid JSON check`);
        if(['json_close','json_sum'].includes(c.op)&&(!Number.isFinite(c.value)||!Number.isFinite(c.tolerance)||c.tolerance<0))errors.push(`${f.id}: invalid tolerance`);
        if(c.op==='json_sum'&&(typeof c.item_key!=='string'||!/^\w+$/.test(c.item_key)))errors.push(`${f.id}: invalid sum key`);
      }else errors.push(`${f?.id}: unknown check operator`);
    }
  }
  if(coverage){
    for(let row=1;row<=18;row++)if(!rows.has(row))errors.push(`Missing acceptance matrix row ${row}`);
    const triggers=data.cases.filter(f=>f?.phase==='trigger');
    for(const expected of [true,false])if(!triggers.some(f=>Array.isArray(f.checks)&&f.checks.some(c=>c?.op==='json_equal'&&c.path==='should_invoke'&&c.value===expected)))errors.push('Missing positive/negative trigger case');
  }
  return errors;
}
function parseResponse(text){
  const r=typeof text==='string'?JSON.parse(text):text;
  if(!r||typeof r.output!=='string'||!r.output.trim()||!(r.template_id===null||(typeof r.template_id==='string'&&/^[a-z]{2}-\d{2}$/.test(r.template_id))))throw Error('Invalid response envelope');
  return {output:r.output,template_id:r.template_id};
}
function valueAt(object,key){for(const part of key.split('.')){if(!object||!Object.hasOwn(object,part))return undefined;object=object[part];}return object;}
function grade(f,response){
  let r;try{r=parseResponse(response);}catch{return {passed:false,requires_human_review:f.requires_human_review,checks:[{name:'nonempty actual response',passed:false}]};}
  const checks=f.checks.map(c=>{
    let passed=false;
    if(c.op==='template_in')passed=c.values.includes(r.template_id);
    else if(c.op==='text_any')passed=c.patterns.some(p=>new RegExp(p,'iu').test(r.output));
    else if(c.op==='text_none')passed=c.patterns.every(p=>!new RegExp(p,'iu').test(r.output));
    else if(['json_equal','json_close','json_sum'].includes(c.op)){
      let actual;try{actual=valueAt(JSON.parse(r.output),c.path);}catch{}
      if(c.op==='json_sum'){
        passed=Array.isArray(actual)&&actual.length>0&&actual.every(item=>Number.isFinite(item?.[c.item_key])&&item[c.item_key]>=0)&&Math.abs(actual.reduce((sum,item)=>sum+item[c.item_key],0)-c.value)<=c.tolerance;
      }
      else if(c.op==='json_equal'){try{assert.deepEqual(actual,c.value);passed=true;}catch{}}
      else passed=Number.isFinite(actual)&&Math.abs(actual-c.value)<=c.tolerance;
    }else throw Error('Unknown check operator');
    return {name:c.name,passed};
  });
  return {passed:checks.every(c=>c.passed),requires_human_review:f.requires_human_review,checks};
}
function loadBundle(root){
  root=path.resolve(root);
  const registry=JSON.parse(fs.readFileSync(path.join(root,'templates.json'),'utf8'));
  const relative=[...new Set(['SKILL.md','templates.json',DEFAULT_FIXTURE,'scripts/regression.cjs','scripts/privacy.cjs','scripts/catalog.cjs','scripts/codex-adapter.cjs','scripts/codex-adapter.json',...registry.categories.map(c=>c.file)])].sort();
  const files=relative.map(file=>({file,text:fs.readFileSync(path.join(root,file),'utf8')}));
  const hash=digest(files.map(x=>x.file+'\0'+x.text+'\0').join(''));
  const templates=new Map();
  for(const category of registry.categories){
    const text=files.find(x=>x.file===category.file).text,anchors=scanMarkdown(text).anchors;
    for(let i=0;i<anchors.length;i++){
      const a=anchors[i],section=text.slice(a.headerStart,anchors[i+1]?.index??text.length),block=scanMarkdown(section).blocks.find(b=>b.marker==='`'&&b.info==='text');
      if(block)templates.set(a.key,{section,copy:section.slice(block.contentStart,block.contentEnd)});
    }
  }
  return {root,registry,hash,files,templates,skill:files.find(x=>x.file==='SKILL.md').text};
}
function buildPacket(f,bundle){
  const responseContract='Return one JSON object with exactly output (string: your actual answer or generated prompt) and template_id (stable lowercase template key such as cd-09 when generating, otherwise null). If the user task asks for JSON, put that JSON serialized as output. Do the task; do not report whether you passed a test.';
  let context;
  if(f.phase==='trigger'){
    const desc=bundle.skill.match(/^description: (.+)$/m)?.[1]||'';
    context='Decide whether the following skill should be invoked for the user request. Output the actual decision as JSON {"should_invoke": boolean, "reason": string} within output. This evaluates description-based selection, not a live client loader.\nSkill description:\n'+desc;
  }else if(f.phase==='generate'){
    const inventory=bundle.registry.templates.map(t=>`${t.id}: ${t.name}`).join('\n');
    context=bundle.skill+'\n\nAvailable template inventory:\n'+inventory+'\n\nCandidate reference sections:\n'+f.context_keys.map(key=>{
      const t=bundle.templates.get(key);if(!t)throw Error('Unknown fixture context key');return t.section;
    }).join('\n');
  }else context=f.context_keys.map(key=>{const t=bundle.templates.get(key);if(!t)throw Error('Unknown fixture context key');return t.copy;}).join('\n');
  const result=redact(responseContract+'\n\n'+context+'\n\nUser request / synthetic test material:\n'+f.request);
  if(scan(result.text).length)throw Error('Input privacy check failed');
  return {id:f.id,phase:f.phase,source_hash:bundle.hash,fixture_hash:fixtureHash(f),message:result.text,privacy:{counts:result.counts,manual_review_required:true}};
}
function gradeRecords(fixtures,record,bundle){
  if(record?.source_hash!==bundle.hash)throw Error('Source hash mismatch');
  if(!Array.isArray(record.cases))throw Error('Missing recorded cases');
  const seen=new Set();for(const c of record.cases){if(!c||typeof c.id!=='string'||seen.has(c.id))throw Error('Invalid or duplicate recorded case');seen.add(c.id);}
  const results=fixtures.map(f=>{
    const r=record.cases.find(x=>x.id===f.id);
    if(!r)return {id:f.id,status:'missing_response',passed:false};
    if(r.fixture_hash!==fixtureHash(f))return {id:f.id,status:'fixture_mismatch',passed:false};
    const output=redact(String(r.output??'')).text;
    if(scan(output).length)return {id:f.id,status:'privacy_refused',passed:false};
    return {id:f.id,status:'graded',...grade(f,{output,template_id:r.template_id})};
  });
  return {mode:'recorded_responses',source_hash:bundle.hash,results};
}
function invokeAdapter(config,packet,root){
  if(!config||typeof config.command!=='string'||!Array.isArray(config.args)||!config.args.every(x=>typeof x==='string'))throw Error('Invalid adapter config');
  const timeout=config.timeout_ms??120000;if(!Number.isInteger(timeout)||timeout<100||timeout>300000)throw Error('Invalid adapter timeout');
  const command=config.command==='$NODE'?process.execPath:config.command;
  const r=cp.spawnSync(command,config.args,{cwd:root,input:JSON.stringify(packet)+'\n',encoding:'utf8',shell:false,windowsHide:true,timeout,maxBuffer:2*1024*1024});
  if(r.error||r.status!==0)return {error:r.error?.code==='ETIMEDOUT'?'adapter_timeout':'adapter_failed'};
  try{return {response:parseResponse(r.stdout)};}catch{return {error:'invalid_adapter_response'};}
}
function summary(results){return {total:results.length,machine_passed:results.filter(r=>r.passed).length,failed_or_error:results.filter(r=>!r.passed).length,pending_human_review:results.filter(r=>r.passed&&r.requires_human_review).length};}
function parseArgs(args){
  const opts={};for(let i=0;i<args.length;i++){
    const key=args[i];if(['--check-fixtures','--list','--run'].includes(key)){opts[key]=true;continue;}
    if(!['--adapter','--out','--ids','--grade','--export'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw Error('Invalid regression arguments');opts[key]=args[++i];
  }return opts;
}
function writeNew(file,value){fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function main(args){
  const opts=parseArgs(args),root=path.resolve(__dirname,'..'),bundle=loadBundle(root),data=JSON.parse(fs.readFileSync(path.join(root,DEFAULT_FIXTURE),'utf8'));
  const errors=validateFixtures(data,true);if(errors.length)throw Error('Invalid fixture set: '+errors.join('; '));
  for(const f of data.cases)for(const key of f.context_keys)if(!bundle.templates.has(key))throw Error('Unknown fixture context');
  const selected=opts['--ids']?opts['--ids'].split(','):data.cases.map(f=>f.id);
  if(new Set(selected).size!==selected.length||selected.some(id=>!data.cases.some(f=>f.id===id)))throw Error('Invalid case selection');
  const fixtures=selected.map(id=>data.cases.find(f=>f.id===id));
  if(opts['--list']){console.log(JSON.stringify(fixtures.map(f=>({id:f.id,phase:f.phase,source_row:f.source_row,requires_human_review:f.requires_human_review})),null,2));return;}
  if(opts['--check-fixtures']){console.log(JSON.stringify({cases:data.cases.length,matrix_rows:18,source_hash:bundle.hash,errors:[]}));return;}
  if(opts['--export']){writeNew(opts['--export'],{source_hash:bundle.hash,kind:'ungraded_model_inputs',cases:fixtures.map(f=>buildPacket(f,bundle))});console.log(JSON.stringify({exported_inputs:fixtures.length,executed:0}));return;}
  if(!opts['--out']||!(opts['--run']||opts['--grade'])||(opts['--run']&&opts['--grade']))throw Error('Choose --run --adapter CONFIG or --grade RECORD, with --out NEW_DIRECTORY');
  const output=path.resolve(opts['--out']);if(fs.existsSync(output))throw Error('Output directory exists; refusing overwrite');
  // Snapshot all inputs before creating output; do not allow reports to collide with source.
  if(output===root||output.startsWith(root+path.sep))throw Error('Reports must be outside the installed skill');
  const runId=crypto.randomUUID();let report,records;
  if(opts['--grade'])report=gradeRecords(fixtures,JSON.parse(fs.readFileSync(opts['--grade'],'utf8')),bundle);
  else{
    if(!opts['--adapter'])throw Error('Live model run requires explicit adapter config');
    const config=JSON.parse(fs.readFileSync(path.resolve(opts['--adapter']),'utf8'));
    records={run_id:runId,source_hash:bundle.hash,mode:'live_adapter',adapter_config_hash:digest(JSON.stringify(config)),cases:[]};
    const results=[];
    for(const f of fixtures){
      if(loadBundle(root).hash!==bundle.hash)throw Error('Skill source changed during run');
      const packet=buildPacket(f,bundle),started=Date.now(),result=invokeAdapter(config,packet,root);
      if(result.error){results.push({id:f.id,status:result.error,passed:false,elapsed_ms:Date.now()-started});continue;}
      const safe=redact(result.response.output);
      if(scan(safe.text).length){results.push({id:f.id,status:'privacy_refused',passed:false});continue;}
      const response={output:safe.text,template_id:result.response.template_id};
      records.cases.push({id:f.id,fixture_hash:fixtureHash(f),...response});
      results.push({id:f.id,status:'graded',...grade(f,response),elapsed_ms:Date.now()-started,privacy_counts:safe.counts});
    }
    report={mode:'live_adapter',source_hash:bundle.hash,adapter_config_hash:records.adapter_config_hash,results};
  }
  if(loadBundle(root).hash!==bundle.hash)throw Error('Skill source changed before reporting');
  report={run_id:runId,...report,summary:summary(report.results),coverage:{selected:fixtures.length,total_fixtures:data.cases.length},limits:['Machine assertions are bounded checks, not proof of semantic correctness.','Cases marked for human review are not fully accepted by automated pass.','Privacy pattern checks cannot guarantee anonymity.']};
  fs.mkdirSync(output,{recursive:false});
  if(records)writeNew(path.join(output,'responses.json'),records);
  writeNew(path.join(output,'report.json'),report);
  console.log(JSON.stringify({mode:report.mode,...report.summary,coverage:report.coverage}));
  if(report.summary.failed_or_error)process.exitCode=1;
}
if(require.main===module){try{main(process.argv.slice(2));}catch{console.error(JSON.stringify({error:'REGRESSION_OPERATION_REFUSED'}));process.exitCode=2;}}
module.exports={validateFixtures,parseResponse,grade,loadBundle,buildPacket,fixtureHash,gradeRecords,invokeAdapter,main};
