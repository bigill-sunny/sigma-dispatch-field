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
  async function wave(request,previous){
    if(!request.rush)return;
    const devices=db.prepare('SELECT endpoint FROM push_devices JOIN sessions ON session=token_hash WHERE user_id=? AND expires>?');
    const jobs=[];
    for(const [id,offer] of Object.entries(request.offers)){
      if(offer.status!=='Invited'||previous[id]?.status==='Invited'&&previous[id].at===offer.at)continue;
      const ttl=Math.floor((offer.replyDeadline-Date.now())/1000);
      if(ttl<=0)continue;
      for(const device of devices.all(Number(id),Date.now()))jobs.push(deliver(device.endpoint,ttl));
    }
    const results=await Promise.allSettled(jobs);
    if(results.some(result=>result.status==='rejected'))console.warn('Some rush notifications could not be delivered.');
  }
  return {publicKey,register,wave,remove:session=>db.prepare('DELETE FROM push_devices WHERE session=?').run(session)};
}
module.exports=pushService;
