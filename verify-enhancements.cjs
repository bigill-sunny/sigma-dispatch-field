'use strict';
const assert=require('node:assert/strict');
const {seed,execute,project}=require('./model');
const {demoAccounts}=require('./accounts');
const {DatabaseSync}=require('node:sqlite');
const pushService=require('./push');

const account=id=>demoAccounts.find(a=>a.id===id);
const clock=Date.parse('2026-11-24T17:00:00Z');
const realNow=Date.now;
Date.now=()=>clock;
let state=seed();
const act=(user,action,id,fields={},extra)=>{
  state=execute(state,{action,id,fields,extra},account(user)).state;
};
const request=()=>state.requests.find(r=>r.id===2);
const candidates=project(state,account(1001)).catalog.guards.filter(g=>g.tier===2&&g.id!==3019);
let standby;
for(const candidate of candidates){
  try{act(1001,'choose-backup',2,{guard:candidate.id,post:'Supervisor'});standby=candidate.id;break;}
  catch(error){if(!error.message)throw error;}
}
assert(standby,'An eligible standby supervisor is required');
assert.equal(project(state,account(standby)).state.requests.find(r=>r.id===2).backup.status,'Invited');
assert.throws(()=>act(3019,'standby-accept',2),/unavailable/i);
act(standby,'standby-accept',2);
assert.equal(request().backup.status,'Ready');
assert.equal(request().assignments.length,1);
assert.throws(()=>act(1001,'activate-backup',2),/open post/);
act(3019,'guard-cancel',2);
act(1001,'activate-backup',2);
assert.equal(request().assignments[0].guard,standby);
assert.equal(request().assignments[0].post,'Supervisor');
assert.equal(project(state,account(standby)).state.requests.find(r=>r.id===2).location.coordinates.length,2);
assert(!project(state,account(2002)).state.requests.find(r=>r.id===2).backup);
assert.throws(()=>act(2002,'feedback',2,{rating:5}),/after/);
Date.now=()=>request().end+60000;
assert.throws(()=>act(2001,'feedback',2,{rating:5}),/after/);
act(2002,'feedback',2,{rating:5,note:'Clear handoff.'});
assert.equal(project(state,account(2002)).state.requests.find(r=>r.id===2).feedback.rating,5);
assert.throws(()=>act(2002,'feedback',2,{rating:4}),/one response/);
Date.now=()=>clock;
act(1001,'broadcast',1);
assert(Object.keys(state.requests[0].offers).length>24);
assert(Object.keys(state.requests[0].offers).every(id=>id!=='3001'));
Date.now=realNow;
console.log('Standby invitation, consent, manager approval, location projection, completed-shift feedback and eligible broadcast passed.');

(async()=>{
  const db=new DatabaseSync(':memory:');
  db.exec("CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER);");
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('test',standby,9999999999999);
  const push=pushService(db);
  push.register('test','https://fcm.googleapis.com/fcm/send/fictional');
  const originalFetch=global.fetch;
  let deliveries=0;
  global.fetch=async (_,options)=>{
    assert.match(options.headers.Authorization,/^vapid t=/);
    deliveries++;
    return {ok:true,status:201};
  };
  try{
    const r=request();
    await push.remind([r],r.start-3600001);
    assert.equal(deliveries,0);
    await push.remind([r],r.start-3600000);
    await pushService(db).remind([r],r.start-3000000);
    assert.equal(deliveries,1);
    await push.remind([{...r,assignments:[]}],r.start-60000);
    await push.remind([r],r.start);
    assert.equal(deliveries,1);
  }finally{global.fetch=originalFetch;db.close();}
  console.log('Reminder timing, persistent deduplication, cancellation and shift-start cutoff passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

const fs=require('node:fs');
const vm=require('node:vm');
const score=vm.runInNewContext(fs.readFileSync('model.js','utf8')+
  "\n(snapshot,id,site)=>{data=snapshot;return attendance(guardBy(id),site).score;}",
  {module:{exports:{}},require,structuredClone});
const rankingGuard=3002;
const rankState={requests:[]};
const baseline=score(rankState,rankingGuard,'harbor');
const record={site:'harbor',history:[],assignments:[{guard:rankingGuard}]};
rankState.requests.push(record);
record.assignments[0].review={arrival:'Late',report:'Accepted'};
const late=score(structuredClone(rankState),rankingGuard,'harbor');
record.assignments[0].review.arrival='On time';
const onTime=score(structuredClone(rankState),rankingGuard,'harbor');
assert(onTime>late);
record.assignments[0].review.report='Needs correction';
const weakReport=score(structuredClone(rankState),rankingGuard,'harbor');
assert(weakReport<onTime);
record.history.push({status:'Guard cancelled',guard:rankingGuard});
const cancelled=score(structuredClone(rankState),rankingGuard,'harbor');
assert(cancelled<weakReport);
record.clientFeedback={rating:5};
assert(score(structuredClone(rankState),rankingGuard,'harbor')>cancelled);
assert.equal(score(structuredClone(rankState),rankingGuard,'cedar'),cancelled);
assert(Number.isFinite(baseline));
console.log('All four ranking inputs affect the score and feedback is site-specific.');
