'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {seed,execute,project,tickDispatch,canApplyCommand}=require('./model');
const {demoAccounts}=require('./accounts');
const account=id=>demoAccounts.find(a=>a.id===id);
const initial=Date.parse('2026-11-24T13:00:00Z');
let now=initial;
Date.now=()=>now;
const run=(state,user,action,id,extra,fields)=>execute(state,{action,id,extra,fields},account(user)).state;
const launch=(s,fields)=>run(s,2001,'create-request',null,null,{
  site:'harbor',date:'2026-11-24',time:'10:15',hours:3,count:1,tier:0,...fields
});
let state=seed();
state=launch(state);
const booking=state.requests.at(-1);
assert(project(state,account(3009)).state.requests.some(r=>r.id===booking.id&&r.canVolunteer),'Isolated midday shift should pass work-cycle rest');
const old={...booking,id:999,start:now-7*86400000,end:now-7*86400000+15*3600000,assignments:[{guard:3009,at:now-7*86400000}]};
const withHistory={...state,requests:[...state.requests,old]};
assert(project(withHistory,account(3009)).state.requests.some(r=>r.id===booking.id&&r.canVolunteer),'An older, disconnected work cycle must not block this request');
const anchor=state.requests.find(r=>r.id===2);
now=anchor.start+6*60000;
const flagged=tickDispatch(state,now);
assert.equal(flagged.requests.find(r=>r.id===2).arrivalFollowUp,now);
const arrived=run(flagged,3019,'check-in',2);
assert.throws(()=>run(arrived,1001,'no-show',2,3019),/unarrived/);
const recovered=run(flagged,1001,'no-show',2,3019);
assert.equal(recovered.requests.find(r=>r.id===2).noShows[0].guard,3019);
assert.equal(recovered.requests.at(-1).recoveryOf,2);
assert.equal(recovered.requests.at(-1).supervisors,1);
assert.equal(recovered.requests.at(-1).end,anchor.end);
assert.equal(recovered.requests.at(-1).assignments.length,0);

now=initial;
let rush=launch(seed(),{time:'09:30',rush:'urgent'});
const request=rush.requests.at(-1);
assert(request.alertCount>0);
const oldOffers=Object.keys(request.offers).length;
now+=6*60000;
const nextWave=tickDispatch(rush,now).requests.find(r=>r.id===request.id);
assert(Object.keys(nextWave.offers).length>oldOffers,'Expired wave should widen automatically');
assert(nextWave.version>request.version);
const volunteerId=Number(Object.keys(request.offers)[0]);
now=initial;
const responded=run(rush,volunteerId,'volunteer',request.id,30);
now=request.start-20*60000;
assert.throws(()=>run(responded,1001,'approve',request.id,volunteerId),/Departure window passed/);
const updatedEta=run(responded,volunteerId,'volunteer',request.id,10);
assert.equal(run(updatedEta,1001,'approve',request.id,volunteerId).requests.at(-1).assignments.length,1);
assert(canApplyCommand({requests:[nextWave]}, {action:'ack',id:nextWave.id,requestVersion:nextWave.version,revision:3},4));
assert(!canApplyCommand({requests:[nextWave]}, {action:'ack',id:nextWave.id,requestVersion:request.version,revision:3},4));

now=initial;
let simultaneous=seed();
simultaneous.requests=[];
simultaneous=launch(simultaneous,{time:'11:00',hours:2});
simultaneous=run(simultaneous,2002,'create-request',null,null,{
  site:'cedar',date:'2026-11-24',time:'11:00',hours:2,count:1,tier:0,supervisors:1
});
const [general,supervisor]=simultaneous.requests;
simultaneous=run(simultaneous,3019,'volunteer',general.id);
simultaneous=run(simultaneous,3009,'volunteer',general.id);
simultaneous=run(simultaneous,3019,'volunteer',supervisor.id);
const planFor=vm.runInNewContext(fs.readFileSync('model.js','utf8')+
  '\n(snapshot,time)=>{data=snapshot;data.now=time;return coveragePlan().map(({request,guard,post})=>({request,guard,post}));}',
  {module:{exports:{}},require,structuredClone});
const proposed=planFor(simultaneous,now);
assert.equal(proposed.length,2);
assert.equal(proposed[0].guard,3019);
assert.equal(proposed[1].guard,3009);
assert.throws(()=>run(simultaneous,1001,'approve-plan',null,null,{plan:[]}),/recommendation changed/);
const assigned=run(simultaneous,1001,'approve-plan',null,null,{plan:proposed});
assert.equal(assigned.requests.find(r=>r.id===general.id).assignments[0].guard,3009);
assert.equal(assigned.requests.find(r=>r.id===supervisor.id).assignments[0].post,'Supervisor');
console.log('Passed midday rest, missing arrival, check-in, no-show recovery, automatic wave, stale edits and simultaneous vacancy approval.');
(async()=>{
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER)');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('retained',3009,now-86400000);
  const push=require('./push')(db);
  push.register('retained','https://fcm.googleapis.com/fcm/send/fictional');
  let requests=0;
  const fetch=global.fetch;
  global.fetch=async()=>({ok:++requests>1,status:requests===1?503:201});
  try{
    const r={id:99,rush:true,offers:{3009:{status:'Invited',at:now,expires:now+60000}}};
    await push.syncOffers([r]);
    assert.equal(push.status()[0].accepted,0);
    await push.syncOffers([r]);
    assert.equal(requests,1);
    now+=16000;
    await require('./push')(db).syncOffers([r]);
    assert.equal(requests,2);
    assert.equal(push.status()[0].accepted,1);
    await push.syncOffers([r]);
    assert.equal(requests,2);
  }finally{
    global.fetch=fetch;
    db.close();
  }
  console.log('Passed opted-in phone retention, durable retry and provider-acceptance deduplication.');
})().catch(error=>{console.error(error);process.exitCode=1});
