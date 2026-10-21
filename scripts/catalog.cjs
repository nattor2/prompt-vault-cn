#!/usr/bin/env node
// templates.json owns metadata; Markdown owns prompt bodies, joined by stable keys.
const fs=require('node:fs');
const path=require('node:path');
const META='templates.json', INDEX='references/00-index.md';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const line=x=>typeof x==='string'&&x.trim().length>0&&!/[\r\n]/.test(x);
function fields(value,expected,label,errors){
  if(!record(value)){errors.push(`${label}: expected object`);return false;}
  for(const k of expected)if(!Object.hasOwn(value,k))errors.push(`${label}: missing ${k}`);
  for(const k of Object.keys(value))if(!expected.includes(k))errors.push(`${label}: unknown field ${k}`);
  return true;
}
function safeFile(root,relative){
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw Error(`Unsafe relative path: ${relative}`);
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep))throw Error(`Path outside skill: ${relative}`);
  let current=root;
  for(const part of relative.split('/')){
    current=path.join(current,part);
    if(fs.existsSync(current)){
      const stat=fs.lstatSync(current);
      if(stat.isSymbolicLink()||(stat.isFile()&&stat.nlink>1))throw Error(`Refusing linked path: ${relative}`);
    }
  }
  return file;
}
const read=(root,file)=>fs.readFileSync(safeFile(root,file),'utf8');
// Only headings and anchors outside Markdown fences are structural metadata.
// Keep raw offsets and line endings so generated headers do not rewrite bodies.
function scanMarkdown(text){
  const anchors=[],headings=[],blocks=[],plain=[];let open=null;
  for(const match of text.matchAll(/[^\n]*(?:\n|$)/g)){
    if(!match[0])continue;
    const raw=match[0],line=raw.replace(/\r?\n$/,''),index=match.index,end=index+raw.length;
    const fence=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(open){
      if(fence&&fence[1][0]===open.marker&&fence[1].length>=open.length&&!fence[2].trim()){
        blocks.push({...open,contentEnd:index,end});open=null;
      }
      continue;
    }
    if(fence){open={marker:fence[1][0],length:fence[1].length,info:fence[2].trim(),start:index,contentStart:end};continue;}
    plain.push({line,index});
    const anchor=line.match(/^<!-- template: ([a-z0-9]+(?:-[a-z0-9]+)*) -->$/);
    if(anchor)anchors.push({key:anchor[1],index,headerStart:end,eol:raw.endsWith('\r\n')?'\r\n':'\n'});
    if(/^### [A-Z]{2}-\d{2} /.test(line))headings.push({line,index});
  }
  return {anchors,headings,blocks,plain,unclosed:open!==null};
}
function validateRegistry(data,errors){
  if(!fields(data,['schema_version','categories','templates'],META,errors))return;
  if(data.schema_version!==1)errors.push('Unsupported schema_version');
  if(!Array.isArray(data.categories)||!data.categories.length||!Array.isArray(data.templates)||!data.templates.length){errors.push('categories and templates must be nonempty arrays');return;}
  const categories=new Map(),files=new Set(),keys=new Set(),ids=new Set();
  for(const c of data.categories){
    if(!fields(c,['key','name','file'],'category',errors))continue;
    if(!/^[A-Z]{2}$/.test(c.key||''))errors.push('Invalid category key');
    if(!line(c.name))errors.push(`${c.key}: invalid category name`);
    if(typeof c.file!=='string'||!/^references\/(?!00-index\.md$)\d{2}-[a-z0-9-]+\.md$/.test(c.file))errors.push(`${c.key}: invalid category file`);
    if(categories.has(c.key)||files.has(c.file))errors.push(`${c.key}: duplicate category key or file`);
    categories.set(c.key,c);files.add(c.file);
  }
  for(const t of data.templates){
    if(!fields(t,['key','id','category','name','level','use','materials','network','fallback'],'template',errors))continue;
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.key||''))errors.push(`${t.id}: invalid stable key`);
    if(keys.has(t.key)||ids.has(t.id))errors.push(`${t.id}: duplicate template key or ID`);
    keys.add(t.key);ids.add(t.id);
    if(!/^[A-Z]{2}-\d{2}$/.test(t.id||'')||!categories.has(t.category)||!t.id?.startsWith(t.category+'-'))errors.push(`${t.id}: invalid ID/category binding`);
    for(const k of ['name','use'])if(!line(t[k]))errors.push(`${t.id}: invalid ${k}`);
    if(!['L1','L2','L3'].includes(t.level))errors.push(`${t.id}: invalid level`);
    if(fields(t.materials,['required','optional'],`${t.id}.materials`,errors)){
      for(const k of ['required','optional'])if(!Array.isArray(t.materials[k])||!t.materials[k].every(line)||new Set(t.materials[k]).size!==t.materials[k].length)errors.push(`${t.id}: invalid materials.${k}`);
      if(Array.isArray(t.materials.required)&&Array.isArray(t.materials.optional)&&t.materials.required.some(x=>t.materials.optional.includes(x)))errors.push(`${t.id}: material is both required and optional`);
    }
    if(fields(t.network,['mode','condition'],`${t.id}.network`,errors)){
      if(!['none','conditional','required'].includes(t.network.mode))errors.push(`${t.id}: invalid network mode`);
      if(t.network.mode==='none'?t.network.condition!=='':!line(t.network.condition))errors.push(`${t.id}: invalid network condition`);
    }
    if(fields(t.fallback,['missing_materials','offline','missing_facts'],`${t.id}.fallback`,errors))for(const k of ['missing_materials','offline','missing_facts'])if(!line(t.fallback[k]))errors.push(`${t.id}: invalid fallback.${k}`);
  }
  for(const c of data.categories){
    if(!record(c))continue;
    const nums=data.templates.filter(t=>record(t)&&t.category===c.key&&typeof t.id==='string').map(t=>Number(t.id.split('-')[1])).sort((a,b)=>a-b);
    if(!nums.length)errors.push(`${c.key}: empty category`);
    nums.forEach((n,i)=>{if(n!==i+1)errors.push(`${c.key}: numbering gap at ${i+1}`);});
  }
}
function networkLabel(t){return {none:'无需联网',conditional:'条件联网',required:'必须联网'}[t.network.mode];}
function header(t){
  const needed=t.materials.required.length?t.materials.required.join('；'):'无，可直接开始';
  const optional=t.materials.optional.length?'；可选：'+t.materials.optional.join('；'):'';
  const network=networkLabel(t)+(t.network.condition?'：'+t.network.condition:'');
  return `### ${t.id} ${t.name}（${t.level}）\n\n**用在**：${t.use}\n\n**材料要求**：必需：${needed}${optional}\n\n**联网要求**：${network}\n\n**降级方式**：缺材料：${t.fallback.missing_materials}；离线：${t.fallback.offline}；缺关键事实：${t.fallback.missing_facts}\n\n`;
}
function indexText(data){
  const cell=x=>x.replace(/\|/g,'／').trim();
  let text='# 模板总索引\n\n由 `templates.json` 自动生成。只改清单和提示词正文，不手工改索引或正文顶部的元数据。完整联网条件、可选材料、离线及关键事实缺失分支见对应正文顶部。\n\n';
  for(const c of data.categories){
    text+=`## ${c.name}（${path.posix.basename(c.file)}）\n\n| 编号 | 模板 | 档位 | 用途 | 必需材料/输入 | 联网 | 缺材料降级 |\n|---|---|---|---|---|---|---|\n`;
    for(const t of data.templates.filter(t=>t.category===c.key).sort((a,b)=>a.id.localeCompare(b.id))){
      const values=[t.id,`[${t.name}](${path.posix.basename(c.file)})`,t.level,t.use,t.materials.required.join('；')||'无',networkLabel(t),t.fallback.missing_materials];
      text+='| '+values.map(cell).join(' | ')+' |\n';
    }
    text+='\n';
  }
  return text+'## 按需工具与方法\n\n- 提示词技术与诊断：`08-techniques.md`。\n- 模型与来源核查：`12-reference.md`。\n- 行为验收：`15-evaluation.md`。\n- 清单字段及维护：`16-catalog.md`。\n- 系统架构与服务依赖优先CD-09；用户流程与页面结构用PD-05。\n';
}
function checkPrompt(file,key,section,errors,category,scanned){
  const blocks=scanned.blocks.filter(b=>b.marker==='`'&&b.info==='text');
  if(blocks.length!==1){errors.push(`${key}: expected one copy block`);return;}
  const block=blocks[0],body=section.slice(block.contentStart,block.contentEnd);let depth=0;
  for(const char of body){if(char==='【')depth++;if(char==='】')depth--;if(depth<0)break;}
  if(depth!==0)errors.push(`${key}: unbalanced Chinese brackets`);
  const bodyScan=scanMarkdown(body);
  function hasBoundary(name){
    const heading=bodyScan.plain.find(x=>x.line==='# '+name);
    if(!heading)return false;
    const next=bodyScan.plain.find(x=>x.index>heading.index&&/^# /.test(x.line));
    return body.slice(heading.index+heading.line.length,next?.index??body.length).trim().length>0;
  }
  if(!hasBoundary('信息与证据边界'))errors.push(`${key}: missing standalone evidence boundary`);
  if(category==='MD'&&!hasBoundary('医疗边界'))errors.push(`${key}: missing standalone medical boundary`);
  if(category==='LG'&&!hasBoundary('法律边界'))errors.push(`${key}: missing standalone legal boundary`);
  for(const label of ['必须替换','可以删','在卡什么'])if(!scanned.plain.some(x=>x.index>=block.end&&x.line.startsWith(`**${label}**：`)&&x.line.slice(label.length+5).trim()))errors.push(`${key}: missing external footer ${label}`);
}
function buildPlan(root){
  root=path.resolve(root);
  const errors=[],outputs=new Map();let data;
  try{data=JSON.parse(read(root,META));}catch(e){return {errors:[`${META}: ${e.message}`],outputs,count:0};}
  validateRegistry(data,errors);
  if(errors.length)return {errors,outputs,count:Array.isArray(data?.templates)?data.templates.length:0};
  const byKey=new Map(data.templates.map(t=>[t.key,t])),categories=new Map(data.categories.map(c=>[c.key,c])),seen=new Set();
  try{
    const refs=fs.readdirSync(safeFile(root,'references'));
    for(const name of refs.filter(x=>x.endsWith('.md'))){
      const file='references/'+name,text=read(root,file);
      const scanned=scanMarkdown(text);
      if(scanned.unclosed)errors.push(`${file}: unclosed code fence`);
      const anchors=scanned.anchors;
      const headingCount=scanned.headings.length;
      if(headingCount!==anchors.length)errors.push(`${file}: template headings must match registered body anchors`);
      const replacements=[];
      for(let i=0;i<anchors.length;i++){
        const a=anchors[i],key=a.key,t=byKey.get(key);
        if(seen.has(key))errors.push(`${key}: duplicate body anchor`);seen.add(key);
        if(!t){errors.push(`${key}: unregistered body anchor`);continue;}
        if(categories.get(t.category).file!==file)errors.push(`${key}: body file differs from category file`);
        const start=a.headerStart,end=anchors[i+1]?.index??text.length,section=text.slice(start,end),sectionScan=scanMarkdown(section),fenceAt=sectionScan.blocks.find(b=>b.marker==='`'&&b.info==='text')?.start??-1;
        if(fenceAt<0){errors.push(`${key}: missing copy block`);continue;}
        const prefix=section.slice(0,fenceAt),lines=prefix.split(/\r?\n/).filter(x=>x.trim());
        if(!/^### [A-Z]{2}-\d{2} .+（L[123]）$/.test(lines[0]||'')||!/^\*\*用在\*\*：.+$/.test(lines[1]||'')||lines.slice(2).some(x=>!/^\*\*(材料要求|联网要求|降级方式)\*\*：.+$/.test(x))){errors.push(`${key}: malformed metadata header; refusing to overwrite prose`);continue;}
        checkPrompt(file,key,section,errors,t.category,sectionScan);
        replacements.push({start,end:start+fenceAt,text:header(t).replace(/\n/g,a.eol)});
      }
      let next=text;for(const r of replacements.reverse())next=next.slice(0,r.start)+r.text+next.slice(r.end);
      if(anchors.length)outputs.set(file,next);
    }
    for(const t of data.templates)if(!seen.has(t.key))errors.push(`${t.id}: missing body anchor ${t.key}`);
    const skill=read(root,'SKILL.md').replace(/\r\n/g,'\n'),front=skill.match(/^---\n([\s\S]*?)\n---/);
    if(!front)errors.push('SKILL.md: missing frontmatter');
    else{
      const keys=[...front[1].matchAll(/^([a-z_-]+):/gm)].map(x=>x[1]);
      const allowed=new Set(['name','display_name','display_name_en','description','description_zh','description_en','category','version','author','agent_created','license','compatibility','metadata','allowed-tools','disable-model-invocation','user-invocable']);
      for(const key of keys)if(!allowed.has(key))errors.push(`SKILL.md: nonstandard field ${key}`);
      if(new Set(keys).size!==keys.length)errors.push('SKILL.md: duplicate frontmatter keys');
      const name=front[1].match(/^name: (.+)$/m)?.[1],desc=front[1].match(/^description: (.+)$/m)?.[1];
      if(!name||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)||name.length>64)errors.push('SKILL.md: invalid name');
      if(!line(desc)||desc.length>1024)errors.push('SKILL.md: invalid description');
      if(!/^agent_created: true[ \t]*$/m.test(front[1]))errors.push('SKILL.md: agent_created must be top-level true');
    }
    if(scanMarkdown(skill).unclosed)errors.push('SKILL.md: unclosed code fence');
    for(const ref of new Set([...skill.matchAll(/(?:references|scripts|tests)\/[\w.-]+\.(?:md|cjs)|templates\.json/g)].map(x=>x[0])))if(!fs.existsSync(safeFile(root,ref)))errors.push(`SKILL.md: missing ${ref}`);
    outputs.set(INDEX,indexText(data));
    for(const [relative]of outputs){const file=safeFile(root,relative);if(fs.existsSync(file)&&!fs.statSync(file).isFile())errors.push(`${relative}: output is not a regular file`);}
  }catch(e){errors.push(e.message);}
  return {errors,outputs,count:data.templates.length};
}
function main(args){
  if(!['--check','--write'].includes(args[0])||args.length>2)throw Error('Usage: node scripts/catalog.cjs --check|--write [skill-root]');
  const root=path.resolve(args[1]||path.join(__dirname,'..')),plan=buildPlan(root),changed=[];
  if(!plan.errors.length){
    for(const [file,expected]of plan.outputs){if(!fs.existsSync(safeFile(root,file))||read(root,file)!==expected)changed.push(file);}
    if(args[0]==='--check')for(const file of changed)plan.errors.push(`${file}: generated metadata/index drift; run --write`);
    else for(const file of changed)fs.writeFileSync(safeFile(root,file),plan.outputs.get(file),'utf8');
  }
  console.log(JSON.stringify({root,templates:plan.count,changed:plan.errors.length?[]:changed,errors:plan.errors},null,2));
  if(plan.errors.length)process.exitCode=1;
}
if(require.main===module){try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={buildPlan,indexText,validateRegistry,scanMarkdown};
