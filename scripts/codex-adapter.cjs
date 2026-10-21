'use strict';
// Adapter protocol: sanitized packet on stdin; actual response envelope on stdout.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
function run(packet,{command=process.env.CODEX_CLI||(process.platform==='win32'?'codex.exe':'codex'),timeout=90000}={}){
  if(!packet||typeof packet.message!=='string'||!packet.message.trim())throw Error('Invalid packet');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prompt-vault-model-'));
  const schema=path.join(dir,'schema.json'),output=path.join(dir,'answer.json');
  try{
    fs.writeFileSync(schema,JSON.stringify({type:'object',properties:{output:{type:'string'},template_id:{type:['string','null']}},required:['output','template_id'],additionalProperties:false}),{flag:'wx'});
    const r=cp.spawnSync(command,['exec','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--output-schema',schema,'--output-last-message',output,'-'],{cwd:dir,input:packet.message,encoding:'utf8',shell:false,windowsHide:true,timeout,maxBuffer:2*1024*1024});
    if(r.error||r.status!==0)throw Error('Model invocation failed');
    const answer=JSON.parse(fs.readFileSync(output,'utf8'));
    if(typeof answer.output!=='string'||!answer.output.trim()||!(answer.template_id===null||typeof answer.template_id==='string'))throw Error('Invalid answer');
    return {output:answer.output,template_id:answer.template_id};
  }finally{
    // Remove only the two exact files this invocation owns; never recursively delete.
    for(const file of [schema,output]){try{fs.unlinkSync(file);}catch{}}
    try{fs.rmdirSync(dir);}catch{}
  }
}
if(require.main===module){try{process.stdout.write(JSON.stringify(run(JSON.parse(fs.readFileSync(0,'utf8'))))+'\n');}catch{process.stderr.write('MODEL_ADAPTER_FAILED\n');process.exitCode=1;}}
module.exports={run};
