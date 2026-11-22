'use strict';
const {generateKeyPairSync,createPrivateKey,sign}=require('node:crypto');
function pushService(db){
  db.exec('CREATE TABLE IF NOT EXISTS push_identity(id INTEGER PRIMARY KEY, jwk TEXT NOT NULL); CREATE TABLE IF NOT EXISTS push_devices(session TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE, endpoint TEXT UNIQUE NOT NULL)');
  let row=db.prepare('SELECT jwk FROM push_identity WHERE id=1').get();
  if(!row){
    const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    row={jwk:JSON.stringify(pair.privateKey.export({format:'jwk'}))};
    db.prepare('INSERT INTO push_identity VALUES(1,?)').run(row.jwk);
  }
  const jwk=JSON.parse(row.jwk);
  const key=createPrivateKey({key:jwk,format:'jwk'});
  const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  function register(session,endpoint){
    const u=new URL(endpoint);
    const allowed=u.hostname==='fcm.googleapis.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com')||u.hostname.endsWith('.push.services.mozilla.com')||u.hostname.endsWith('.notify.windows.com');
    if(!allowed||u.protocol!=='https:'||u.port||u.username||u.password||u.hash)throw Error('Unsupported push service.');
    db.prepare('INSERT OR REPLACE INTO push_devices VALUES(?,?)').run(session,u.href);
  }
  async function deliver(endpoint,ttl){
    const claims={aud:new URL(endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:process.env.SIGMA_PUSH_CONTACT||'mailto:dispatch@example.org'};
    const input=encode({typ:'JWT',alg:'ES256'})+'.'+encode(claims);
    const signature=sign('sha256',Buffer.from(input),{key,dsaEncoding:'ieee-p1363'}).toString('base64url');
    const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:'vapid t='+input+'.'+signature+', k='+publicKey,TTL:String(ttl),Urgency:'high'}});
    if([404,410].includes(response.status))db.prepare('DELETE FROM push_devices WHERE endpoint=?').run(endpoint);
    if(!response.ok)throw Error('Push service returned '+response.status);
  }
  const deviceRetention=30*86400000;
  const devices=db.prepare('SELECT endpoint FROM push_devices JOIN sessions ON session=token_hash WHERE user_id=? AND expires>?');
  db.exec('CREATE TABLE IF NOT EXISTS shift_reminders (shift INTEGER NOT NULL, guard INTEGER NOT NULL, assigned INTEGER NOT NULL, start INTEGER NOT NULL, endpoint TEXT NOT NULL, PRIMARY KEY(shift,guard,assigned,start,endpoint))');
  const reminderSent=db.prepare('SELECT 1 FROM shift_reminders WHERE shift=? AND guard=? AND assigned=? AND start=? AND endpoint=?');
  const saveReminder=db.prepare('INSERT OR IGNORE INTO shift_reminders VALUES(?,?,?,?,?)');
  let checkingReminders=false;
  async function remind(requests,now=Date.now()){
    if(checkingReminders)return;
    checkingReminders=true;
    try{
      const jobs=[];
      for(const r of requests){
        if(r.start<=now||r.start-now>3600000)continue;
        const ttl=Math.max(1,Math.floor((r.start-now)/1000));
        for(const assignment of r.assignments){
          for(const device of devices.all(assignment.guard,now-deviceRetention)){
            const key=[r.id,assignment.guard,assignment.at,r.start,device.endpoint];
            if(reminderSent.get(...key))continue;
            jobs.push(deliver(device.endpoint,ttl).then(()=>saveReminder.run(...key)));
          }
        }
      }
      await Promise.allSettled(jobs);
    }finally{checkingReminders=false;}
  }
  async function wave(request,previous){
    if(!request.rush)return;
    const jobs=[];
    for(const [id,offer] of Object.entries(request.offers)){
      if(offer.status!=='Invited'||previous[id]?.status==='Invited'&&previous[id].at===offer.at)continue;
      const ttl=Math.floor((offer.replyDeadline-Date.now())/1000);
      if(ttl<=0)continue;
      for(const device of devices.all(Number(id),Date.now()-deviceRetention))jobs.push(deliver(device.endpoint,ttl));
    }
    const results=await Promise.allSettled(jobs);
    if(results.some(result=>result.status==='rejected'))console.warn('Some rush notifications could not be delivered.');
  }
  db.exec('CREATE TABLE IF NOT EXISTS offer_delivery (shift INTEGER, guard INTEGER, offered INTEGER, endpoint TEXT, state TEXT, attempts INTEGER, next INTEGER, PRIMARY KEY(shift,guard,offered,endpoint))');
  const findDelivery=db.prepare('SELECT state,attempts,next FROM offer_delivery WHERE shift=? AND guard=? AND offered=? AND endpoint=?');
  const saveDelivery=db.prepare('INSERT OR REPLACE INTO offer_delivery VALUES(?,?,?,?,?,?,?)');
  const deliveryStatus=db.prepare("SELECT shift,guard,offered,MAX(CASE WHEN state='accepted' THEN 1 ELSE 0 END) AS accepted,MIN(CASE WHEN attempts>=3 THEN 1 ELSE 0 END) AS exhausted FROM offer_delivery GROUP BY shift,guard,offered");
  let checkingOffers=false;
  async function syncOffers(requests){
    if(checkingOffers)return;
    checkingOffers=true;
    try{
      const now=Date.now();
      const jobs=[];
      for(const r of requests){
        if(!r.rush)continue;
        for(const [guard,offer] of Object.entries(r.offers)){
          if(offer.status!=='Invited'||offer.expires<=now)continue;
          for(const device of devices.all(Number(guard),now-deviceRetention)){
            const key=[r.id,Number(guard),offer.at,device.endpoint];
            const previous=findDelivery.get(...key);
            if(previous?.state==='accepted'||previous?.next>now||previous?.attempts>=3)continue;
            jobs.push({key,endpoint:device.endpoint,expires:offer.expires,attempts:(previous?.attempts||0)+1});
          }
        }
      }
      for(let start=0;start<jobs.length;start+=8){
        await Promise.allSettled(jobs.slice(start,start+8).map(async job=>{
          const ttl=Math.floor((job.expires-Date.now())/1000);
          if(ttl<=0)return;
          let state='retry';
          try{await deliver(job.endpoint,ttl);state='accepted';}catch{}
          saveDelivery.run(...job.key,state,job.attempts,Date.now()+15000*job.attempts);
        }));
      }
      if(jobs.length&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='board'").get())db.exec('UPDATE board SET revision=revision+1 WHERE id=1');
    }finally{checkingOffers=false;}
  }
  return {publicKey,register,wave,remind,syncOffers,status:()=>deliveryStatus.all(),remove:session=>db.prepare('DELETE FROM push_devices WHERE session=?').run(session)};
}
module.exports=pushService;
