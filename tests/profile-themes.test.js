import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { signAccessToken } from "../modules/auth/service.js";
import User from "../modules/users/model.js";
import { createProfileThemeHandlers } from "../modules/users/profileTheme.controller.js";
import { PROFILE_THEMES,effectiveProfileThemeId,addProfileThemeResponse } from '../utils/profileThemes.js';

const now=new Date('2026-10-09T12:00:00Z');
const owner='64b000000000000000000001';
function store(initial={}) {
  const user={_id:owner,isPro:true,proExpiryDate:new Date('2027-01-01'),avatar:'avatar',coverImage:'cover',bio:'bio',followers:['other'],garage:[{model:'bike'}],...initial};
  const calls=[];
  return {user,calls,Model:{findOneAndUpdate(filter,update,options){
    calls.push({filter,update,options});
    const allowed=filter._id===owner && (!filter.$or || user.isAdmin ||
      ((user.isPro || user.isPremium) && (!user.proExpiryDate || user.proExpiryDate>now)));
    if(allowed) Object.assign(user,update.$set);
    return {select:async() => allowed ? {...user} : null};
  }}};
}
async function invoke(handler,body,userId=owner,params={}) {
  let error;
  const res={statusCode:0,status(code){this.statusCode=code;return this;},json(payload){this.payload=payload;return this;}};
  await handler({user:userId ? {id:userId} : undefined,body,params},res,e=>{error=e;});
  return {res,error};
}
test('catalog contains nineteen premium layouts plus a default, with stable IDs',()=>{
  assert.equal(PROFILE_THEMES.filter(t=>t.requiresPro).length,19);
  assert.equal(new Set(PROFILE_THEMES.map(t=>t.id)).size,20);
});
test('legacy, unknown, unsupported and expired preferences fall back without deleting preference',()=>{
  assert.equal(effectiveProfileThemeId({},now),'default');
  for(const patch of [{profileThemeId:'removed'}, {profileThemeConfigVersion:999}, {isPro:false}, {proExpiryDate:new Date('2020-01-01')}]) {
    const user={isPro:true,profileThemeId:'midnight-carbon',...patch};
    assert.equal(effectiveProfileThemeId(user,now),'default');
    assert.equal(addProfileThemeResponse(user,now).profileThemeId,patch.profileThemeId || 'midnight-carbon');
  }
});
test('renewal restores stored choice; public display does not depend on visitor plan',()=>{
  const user={isPremium:true,profileThemeId:'atlas-mono',proExpiryDate:new Date('2020-01-01')};
  assert.equal(effectiveProfileThemeId(user,now),'default');
  user.proExpiryDate=new Date('2027-01-01');
  assert.equal(effectiveProfileThemeId(user,now),'atlas-mono');
  assert.equal(effectiveProfileThemeId({isAdmin:true,profileThemeId:'atlas-mono'},now),'atlas-mono');
});
test('schema defaults support old users without modifying profile content',()=>{
  const user=new User({name:'Rider',email:'test@example.com',password:'test'});
  assert.equal(user.profileThemeId,'default'); assert.equal(user.profileThemeConfigVersion,1);
});
test('PRO mutation writes only preference, atomically scoped to authenticated owner',async()=>{
  const s=store(); const before=structuredClone(s.user);
  const handlers=createProfileThemeHandlers({UserModel:s.Model,clock:()=>now});
  const {res,error}=await invoke(handlers.update,{themeId:'apex-racing',configVersion:1});
  assert.equal(error,undefined);assert.equal(res.statusCode,200);
  assert.equal(res.payload.data.effectiveProfileThemeId,'apex-racing');
  assert.equal(s.calls[0].filter._id,owner);assert.ok(s.calls[0].filter.$or);
  assert.deepEqual(Object.keys(s.calls[0].update.$set).sort(),['profileThemeConfigVersion','profileThemeId','profileThemeUpdatedAt']);
  for(const field of ['avatar','coverImage','bio','followers','garage']) assert.deepEqual(s.user[field],before[field]);
});
test('expired and free users cannot activate PRO even if middleware has stale data',async()=>{
  for(const patch of [{isPro:false},{proExpiryDate:new Date('2020-01-01')}]) {
    const s=store(patch);const h=createProfileThemeHandlers({UserModel:s.Model,clock:()=>now});
    const {error}=await invoke(h.update,{themeId:'neon-velocity',configVersion:1});
    assert.equal(error.statusCode,403);assert.equal(s.user.profileThemeId,undefined);
  }
});
test('forged entitlement, owner and executable configuration are rejected',async()=>{
  const s=store({isPro:false});const h=createProfileThemeHandlers({UserModel:s.Model,clock:()=>now});
  for(const injected of [{isPro:true},{userId:'other'},{layout:'eval()'}]) {
    const {error}=await invoke(h.update,{themeId:'atlas-mono',configVersion:1,...injected});
    assert.equal(error.statusCode,400);
  }
  assert.equal(s.calls.length,0);
});
test('unknown IDs, malformed IDs and incompatible version return controlled errors',async()=>{
  const s=store();const h=createProfileThemeHandlers({UserModel:s.Model,clock:()=>now});
  for(const [body,code] of [[{themeId:'unknown',configVersion:1},404],[{themeId:{$ne:null},configVersion:1},400],[{themeId:'atlas-mono',configVersion:9},409]]) {
    assert.equal((await invoke(h.update,body)).error.statusCode,code);
  }
  assert.equal(s.calls.length,0);
});
test('free owner can reset; missing session cannot mutate; other owner cannot be targeted',async()=>{
  const s=store({isPro:false,profileThemeId:'atlas-mono'});const h=createProfileThemeHandlers({UserModel:s.Model,clock:()=>now});
  assert.equal((await invoke(h.reset,undefined,null)).error.statusCode,401);
  assert.equal((await invoke(h.reset,undefined,'other')).error.statusCode,404);
  assert.equal((await invoke(h.reset)).res.payload.data.profileThemeId,'default');
  assert.equal(s.calls.at(-1).filter.$or,undefined);
});
test('catalog and theme details are available without PRO or login',async()=>{
  const h=createProfileThemeHandlers();
  assert.equal((await invoke(h.catalog,undefined,null)).res.payload.data.themes.length,20);
  assert.equal((await invoke(h.detail,undefined,null,{themeId:'atlas-mono'})).res.statusCode,200);
  assert.equal((await invoke(h.detail,undefined,null,{themeId:'nordic-horizon'})).res.statusCode,200);
  assert.equal((await invoke(h.detail,undefined,null,{themeId:'removed'})).error.statusCode,404);
});
test('production routes protect writes and register catalog before catch-all',()=>{
  const routes=fs.readFileSync(new URL('../modules/users/routes.js',import.meta.url),'utf8');
  assert.ok(routes.includes("router.patch('/profile/theme', protect, updateProfileTheme)"));
  assert.ok(routes.includes("router.delete('/profile/theme', protect, resetProfileTheme)"));
  assert.ok(routes.indexOf("'/profile-themes'")<routes.indexOf("'/:id'"));
});
test('HTTP API round trip persists preference, denies free activation and permits public preview',async()=>{
  const s=store();const h=createProfileThemeHandlers({UserModel:s.Model,clock:()=>now});
  const app=express();app.use(express.json());
  app.get('/users/profile-themes',h.catalog);
  const originalFind=User.findById;
  const originalSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='profile-theme-http-test-secret-32-characters';
  User.findById=() => ({select(){return this;},lean:async() => ({...s.user,tokenVersion:1})});
  const token=signAccessToken({_id:owner,tokenVersion:1});
  app.use(protect);
  app.patch('/users/profile/theme',h.update);app.delete('/users/profile/theme',h.reset);
  app.use((err,req,res,next)=>res.status(err.statusCode||500).json({message:err.message}));
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+server.address().port;
    assert.equal((await fetch(base+'/users/profile-themes')).status,200);
    assert.equal((await fetch(base+'/users/profile/theme',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({themeId:'atlas-mono',configVersion:1})})).status,401);
    const opts={method:'PATCH',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({themeId:'atlas-mono',configVersion:1})};
    const saved=await fetch(base+'/users/profile/theme',opts);assert.equal(saved.status,200);
    assert.equal((await saved.json()).data.profileThemeId,'atlas-mono');
    s.user.isPro=false;assert.equal((await fetch(base+'/users/profile/theme',opts)).status,403);
    assert.equal(s.user.profileThemeId,'atlas-mono');
    assert.equal((await fetch(base+'/users/profile/theme',{method:'DELETE',headers:{authorization:'Bearer '+token}})).status,200);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    User.findById=originalFind;
    if(originalSecret===undefined) delete process.env.JWT_SECRET;else process.env.JWT_SECRET=originalSecret;
  }
});

test('public admin preference retains the existing lifetime entitlement after privacy stripping',()=>{
  const response=addProfileThemeResponse({isAdmin:true,isPro:false,profileThemeId:'heritage-machine',proExpiryDate:new Date('2020-01-01')},now);
  delete response.isAdmin;
  assert.equal(response.isPro,true);assert.equal(response.proExpiryDate,null);
  assert.equal(response.effectiveProfileThemeId,'heritage-machine');
});
