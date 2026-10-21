'use strict';
// Local, deterministic pattern matching. No network, environment or dependencies.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const SAFE = /^(?:\[REDACTED_[A-Z_]+_\d+\]|【必填：[^】\r\n]*】)$/u;
const labels = {
  '姓名':'NAME', '患者姓名':'NAME', 'name':'NAME', 'full_name':'NAME',
  '住址':'ADDRESS', '地址':'ADDRESS', '家庭住址':'ADDRESS', 'address':'ADDRESS',
  '病历号':'MEDICAL_RECORD', 'medical_record':'MEDICAL_RECORD', 'medical_record_number':'MEDICAL_RECORD',
  '学号':'STUDENT_ID', 'student_id':'STUDENT_ID',
  'password':'PASSWORD', '密码':'PASSWORD', 'token':'TOKEN', '令牌':'TOKEN',
};

function scan(text) {
  if (typeof text !== 'string') throw new TypeError('Expected text');
  const candidates = [];
  const add = (kind, start, end, priority = 0) => {
    if (end > start && !SAFE.test(text.slice(start, end))) candidates.push({kind,start,end,priority});
  };
  // Quoted JSON values may contain whitespace and escaped quote characters.
  const keys = Object.keys(labels).sort((a,b)=>b.length-a.length).join('|');
  const field = new RegExp('(?:^|[\\s,{;；|])(?:"('+keys+')"|\'('+keys+')\'|(?:\\*\\*)?('+keys+')(?:\\*\\*)?)[^\\S\\r\\n]*[:：=][^\\S\\r\\n]*', 'giu');
  for (const m of text.matchAll(field)) {
    let start = m.index + m[0].length, end = start;
    const quote = text[start];
    if (quote === '"' || quote === "'") {
      start++; end = start;
      while (end < text.length && text[end] !== '\r' && text[end] !== '\n') {
        if (text[end] === '\\') { end += Math.min(2, text.length-end); continue; }
        if (text[end] === quote) break;
        end++;
      }
    } else {
      while (end < text.length && !/[\r\n,，;；}。|]/u.test(text[end])) end++;
      while (end > start && /\s/u.test(text[end-1])) end--;
    }
    add(labels[(m[1] || m[2] || m[3]).toLowerCase()], start, end, 1);
  }
  const patterns = [
    ['EMAIL', /(?<![A-Za-z0-9.!#$%&'*+/=?^_`{|}~-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}(?![A-Za-z0-9_-])/gu],
    ['PHONE', /(?<![\dA-Za-z])(?:\+?86[- ]?)?1[3-9]\d{9}(?![\dA-Za-z])/gu],
    ['ID_CARD', /(?<![\dA-Za-z])(?:\d{17}[\dXx]|\d{15})(?![\dA-Za-z])/gu],
    ['API_TOKEN', /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/gu],
  ];
  for (const [kind, regex] of patterns) for (const m of text.matchAll(regex)) add(kind,m.index,m.index+m[0].length);
  // A labelled field owns its full span; suppress nested matches consistently.
  candidates.sort((a,b)=>b.priority-a.priority || a.start-b.start || b.end-a.end);
  const selected=[];
  for(const c of candidates) if(!selected.some(f=>c.start<f.end && c.end>f.start)) selected.push(c);
  return selected.sort((a,b)=>a.start-b.start).map(({kind,start,end})=>({kind,start,end}));
}

function redact(text) {
  const findings=scan(text), counts={}, values=new Map(), next={};
  for(const m of text.matchAll(/\[REDACTED_([A-Z_]+)_(\d+)\]/g)) next[m[1]]=Math.max(next[m[1]]||0,Number(m[2]));
  let result='', cursor=0;
  for(const f of findings) {
    counts[f.kind]=(counts[f.kind]||0)+1;
    const key=text.slice(f.start,f.end);
    if(!values.has(key)) {next[f.kind]=(next[f.kind]||0)+1;values.set(key,`[REDACTED_${f.kind}_${next[f.kind]}]`);}
    // Keep numeric JSON identifier replacement parseable.
    const jsonScalar=/"[^"\r\n]+"\s*:\s*$/.test(text.slice(0,f.start))&&/^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/.test(key);
    result+=text.slice(cursor,f.start)+(jsonScalar?JSON.stringify(values.get(key)):values.get(key)); cursor=f.end;
  }
  result+=text.slice(cursor);
  return {text:result,counts,manual_review_required:true};
}

// Refuse links in every path component, including junction/symlink parents.
function inspectPath(file, missingLeaf=false) {
  const absolute=path.resolve(file), parsed=path.parse(absolute);
  let current=parsed.root;
  const parts=absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for(let i=0;i<parts.length;i++) {
    current=path.join(current,parts[i]);
    let st;
    try {st=fs.lstatSync(current);} catch(e) {if(e.code==='ENOENT' && missingLeaf && i===parts.length-1)return absolute;throw e;}
    if(st.isSymbolicLink()) throw new Error('Unsafe path');
    if(i<parts.length-1 && !st.isDirectory())throw new Error('Unsafe path');
    if(i===parts.length-1 && missingLeaf)throw new Error('Output exists');
  }
  return absolute;
}
function readText(file) {
  const absolute=inspectPath(file), before=fs.lstatSync(absolute);
  if(!before.isFile() || before.nlink!==1)throw new Error('Unsafe input');
  const fd=fs.openSync(absolute,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened=fs.fstatSync(fd);
    if(!opened.isFile() || opened.nlink!==1 || opened.dev!==before.dev || opened.ino!==before.ino)throw new Error('Unsafe input');
    const bytes=fs.readFileSync(fd);
    const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text))throw new Error('Binary input');
    return text;
  } finally {fs.closeSync(fd);}
}
function publish(output,text) {
  const absolute=inspectPath(output,true);
  const temporary=path.join(path.dirname(absolute),'.privacy-'+randomBytes(16).toString('hex')+'.tmp');
  let created=false;
  try {
    const fd=fs.openSync(temporary,'wx',0o600); created=true;
    try {fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    if(scan(readText(temporary)).length)throw new Error('Verification failed');
    inspectPath(output,true);
    // link is an atomic no-replace publication of the fully written file.
    fs.linkSync(temporary,absolute);
  } finally {if(created)fs.unlinkSync(temporary);}
}
function main(args) {
  try {
    if(args.length===2 && args[0]==='--check') {
      const findings=scan(readText(args[1])), counts={};
      for(const f of findings)counts[f.kind]=(counts[f.kind]||0)+1;
      process.stdout.write(JSON.stringify({counts,findings,manual_review_required:true})+'\n');
      return findings.length?1:0;
    }
    if(args.length===4 && args[0]==='--redact' && args[2]==='--out') {
      if(path.resolve(args[1])===path.resolve(args[3]))throw new Error('Input collision');
      const result=redact(readText(args[1]));
      if(scan(result.text).length)throw new Error('Verification failed');
      publish(args[3],result.text);
      process.stdout.write(JSON.stringify({counts:result.counts,manual_review_required:true})+'\n');
      return 0;
    }
    throw new Error('Invalid arguments');
  } catch {
    // Do not echo paths, arguments, OS exceptions, snippets or fingerprints.
    process.stderr.write(JSON.stringify({error:'PRIVACY_OPERATION_REFUSED',manual_review_required:true})+'\n');
    return 2;
  }
}
module.exports={scan,redact};
if(require.main===module)process.exitCode=main(process.argv.slice(2));
