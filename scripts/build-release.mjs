import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const validateReleaseDestination=output=>{
    const resolved=path.resolve(output);
    const comparedOutput=process.platform==='win32'?resolved.toLowerCase():resolved;
    const comparedRoot=process.platform==='win32'?sourceRoot.toLowerCase():sourceRoot;
    if(comparedOutput===comparedRoot || comparedOutput.startsWith(comparedRoot+path.sep) || comparedRoot.startsWith(comparedOutput+path.sep))throw new Error('Release destination must be outside the repository');
    return resolved;
};
export const collectReleasePlan=async()=>{
    const included=new Set();
    const visit=async relative=>{
        relative=relative.split(path.sep).join('/');
        const source=path.resolve(sourceRoot,relative);
        if(!source.startsWith(sourceRoot+path.sep))throw new Error('Import escapes source tree');
        if(included.has(relative))return;
        const text=await fs.readFile(source,'utf8');included.add(relative);
        for(const match of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g))await visit(path.relative(sourceRoot,path.resolve(path.dirname(source),match[1])));
    };
    await visit('server.js');await visit('index.js');
    for(const filename of ['package.json','package-lock.json','firebase.json','ecosystem.config.cjs','Dockerfile','.dockerignore']){
        try{await fs.access(path.join(sourceRoot,filename));included.add(filename);}catch(error){if(error.code!=='ENOENT')throw error;}
    }
    const files=[...included].sort();const hash=crypto.createHash('sha256');
    for(const relative of files){
        if(/serviceAccount|\.env|\.tar|archive|^(node_modules|uploads|attic|controllers|routes|services)[\/\\]/i.test(relative))throw new Error('Private, archived or legacy file in release');
        hash.update(relative);hash.update(await fs.readFile(path.join(sourceRoot,relative)));
    }
    return {files,sourceFingerprint:hash.digest('hex')};
};
// HTTPS remains mandatory by default. An external, consumed approval binds one package to one source and output.
export const validateReleaseAcceptance=(plan,acceptance,{output,httpApproval,now=Date.now()}={})=>{
    let httpExceptionUsed=false;
    if(httpApproval){
        const approvedAt=Date.parse(httpApproval.approvedAt),expiresAt=Date.parse(httpApproval.expiresAt);
        if(httpApproval.scope!=='package-only'||httpApproval.once!==true||httpApproval.api!=='http://31.210.36.57'||acceptance?.live?.api!==httpApproval.api||httpApproval.sourceFingerprint!==plan.sourceFingerprint||!output||!httpApproval.output||validateReleaseDestination(httpApproval.output)!==validateReleaseDestination(output)||!Number.isFinite(approvedAt)||!Number.isFinite(expiresAt)||approvedAt>now+60000||expiresAt<=now||expiresAt<=approvedAt||expiresAt-approvedAt>3600000)throw new Error('HTTP package approval is invalid, expired or belongs to another source/output');
        httpExceptionUsed=true;
    }
    const required=['health','capabilities','login','discover','reels','messages','https','node20','mongo','redis','flutter'];
    if(!acceptance||acceptance.sourceFingerprint!==plan.sourceFingerprint||required.some(key=>!(key==='https'&&httpExceptionUsed)&&acceptance.checks?.[key]!==true))throw new Error('Live acceptance is incomplete or belongs to different source files');
    const checkedAt=Date.parse(acceptance.checkedAt);if(!Number.isFinite(checkedAt)||now-checkedAt>86400000||checkedAt>now+60000)throw new Error('Live acceptance must be current');
    return {httpExceptionUsed};
};
export const buildRelease=async(output,acceptance,httpApprovalFile)=>{
    output=validateReleaseDestination(output);const plan=await collectReleasePlan();
    const approvalPath=httpApprovalFile?validateReleaseDestination(httpApprovalFile):null;
    const httpApproval=approvalPath?JSON.parse(await fs.readFile(approvalPath,'utf8')):null;
    const {httpExceptionUsed}=validateReleaseAcceptance(plan,acceptance,{output,httpApproval});
    for(const target of [output,output+'.tar.gz']){try{await fs.access(target);throw new Error('Release destination already exists');}catch(error){if(error.code!=='ENOENT')throw error;}}
    if(httpExceptionUsed)await fs.writeFile(approvalPath+'.used',JSON.stringify({usedAt:new Date().toISOString(),sourceFingerprint:plan.sourceFingerprint,output}),{flag:'wx'});
    for(const relative of plan.files){const destination=path.join(output,relative);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.copyFile(path.join(sourceRoot,relative),destination);}
    await fs.writeFile(path.join(output,'release-manifest.json'),JSON.stringify({...plan,acceptance:{api:acceptance.live?.api,checkedAt:acceptance.checkedAt,httpExceptionUsed,scope:'Package preparation only; candidate not deployed'}},null,2));
    const archive=output+'.tar.gz';const packed=spawnSync('tar',['-czf',archive,'-C',output,'.'],{encoding:'utf8'});
    if(packed.error || packed.status!==0)throw new Error('Release archive could not be created');
    return {files:plan.files.length,output,archive,httpExceptionUsed};
};
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
    const args=process.argv.slice(2);
    if(args.includes('--plan'))console.log(JSON.stringify(await collectReleasePlan(),null,2));
    else {
        const output=args.find(value=>!value.startsWith('--')) || path.join(os.tmpdir(),'motonom-releases',new Date().toISOString().replaceAll(':','-'),'release');
        const evidence=args.find(value=>value.startsWith('--acceptance='))?.slice(13);
        if(!evidence)throw new Error('Provide --acceptance=PATH after live acceptance passes; --plan is read-only');
        const approval=args.find(value=>value.startsWith('--http-approval='))?.slice(16);
        console.log(JSON.stringify(await buildRelease(output,JSON.parse(await fs.readFile(evidence,'utf8')),approval)));
    }
}
