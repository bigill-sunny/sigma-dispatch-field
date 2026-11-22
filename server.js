'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {randomBytes,createHash,scryptSync,timingSafeEqual}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {seed,execute,project}=require('./model.js');
const {demoAccounts,demoPassword,loginKey}=require('./accounts.js');

(function loadDotEnv(){
  const envPath=path.join(__dirname,'.env');
  if(!fs.existsSync(envPath))return;
  for(const raw of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith('#'))continue;
    const eq=line.indexOf('=');
    if(eq<=0)continue;
    const key=line.slice(0,eq).trim();
    let val=line.slice(eq+1).trim();
    if((val.startsWith('"')&&val.endsWith('"'))||(val.startsWith("'")&&val.endsWith("'")))val=val.slice(1,-1);
    if(key&&process.env[key]===undefined)process.env[key]=val;
  }
})();

const port=Number(process.env.SIGMA_PORT||4173);
const host=process.env.SIGMA_HOST||'127.0.0.1';
const origins=new Set(['http://127.0.0.1:'+port,'http://localhost:'+port]);
if(process.env.SIGMA_ORIGIN)origins.add(new URL(process.env.SIGMA_ORIGIN).origin);
if(host!=='127.0.0.1'&&!process.env.SIGMA_ORIGIN)throw Error('Set SIGMA_ORIGIN to the URL used to open the app.');
const hosts=new Set([...origins].map(origin=>new URL(origin).host));
const db=new DatabaseSync(process.env.SIGMA_DB||path.join(__dirname,'dispatch.sqlite'));
db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS board(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('admin','client','guard')),
    name TEXT NOT NULL, client_id TEXT, salt BLOB NOT NULL, password_hash BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_aliases(alias TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id));
  CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
`);
db.prepare('INSERT OR IGNORE INTO board VALUES(1,0,?)').run(JSON.stringify(seed('rush')));
{
  const insert=db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)');
  const alias=db.prepare('INSERT INTO login_aliases VALUES(?,?)');
  db.exec('BEGIN IMMEDIATE');
  try{
    const existing=new Set(db.prepare("SELECT id FROM users").all().map(row=>row.id));
    for(const account of demoAccounts){
      if(existing.has(account.id))continue;
      const salt=randomBytes(16);
      insert.run(account.id,account.role,account.name,account.client||null,salt,scryptSync(demoPassword(account),salt,64));
      for(const key of [account.id,...(account.company?[account.name,account.company]:[])])alias.run(loginKey(key),account.id);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}

const push=require("./push.js")(db);
const linked=db.prepare('SELECT endpoint FROM push_devices WHERE session=?');
const registered=db.prepare('SELECT DISTINCT user_id FROM push_devices JOIN sessions ON session=token_hash WHERE expires>?');
function workspace(state,account,token){
  const record=project(state,account);
  if(account.role==='admin')record.state.phoneGuards=registered.all(Date.now()).map(row=>row.user_id);
  if(account.role==='guard')record.state.phoneRegistered=Boolean(linked.get(hashToken(token)));
  return record;
}
db.exec(`CREATE TRIGGER IF NOT EXISTS device_added AFTER INSERT ON push_devices BEGIN UPDATE board SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER IF NOT EXISTS device_removed AFTER DELETE ON push_devices BEGIN UPDATE board SET revision=revision+1 WHERE id=1; END;`);
const read=db.prepare('SELECT revision,state FROM board WHERE id=1');
const save=db.prepare('UPDATE board SET state=?,revision=revision+1 WHERE id=1 AND revision=?');
const findUser=db.prepare('SELECT users.* FROM users JOIN login_aliases ON users.id=user_id WHERE alias=?');
const findSession=db.prepare('SELECT users.id,role,name,client_id FROM sessions JOIN users ON users.id=user_id WHERE token_hash=? AND expires>?');
const createSession=db.prepare('INSERT INTO sessions VALUES(?,?,?)');
const deleteSession=db.prepare('DELETE FROM sessions WHERE token_hash=?');
const lifetime=8*60*60;
const dummySalt=randomBytes(16);
const dummyHash=randomBytes(64);
const attempts=new Map();
const hashToken=token=>createHash('sha256').update(token).digest('hex');
const identity=user=>({id:user.id,role:user.role,name:user.name,client:user.client_id,guard:user.role==='guard'?user.id:null});
const cookie=(token,maxAge,secure)=>'sigma_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+maxAge+(secure?'; Secure':'');
const sessionToken=req=>req.headers.cookie?.match(/(?:^|;\s*)sigma_session=([\da-f]{64})(?:;|$)/)?.[1];
const files=new Map([
  ['/',['index.html','text/html']],['/app.js',['app.js','text/javascript']],['/model.js',['model.js','text/javascript']],
  ['/guard.js',['guard.js','text/javascript']],['/chat.js',['chat.js','text/javascript']],
  ['/manifest.webmanifest',['manifest.webmanifest','application/manifest+json']],['/sw.js',['sw.js','text/javascript']],
  ['/icon-192.png',['icon-192.png','image/png']],['/icon-512.png',['icon-512.png','image/png']]
]);
function send(res,status,body,headers={}) {
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',...headers});
  res.end(body===undefined?undefined:JSON.stringify(body));
}
async function readBody(req) {
  let body='';
  req.setEncoding('utf8');
  for await(const part of req){
    body+=part;
    if(body.length>20000)throw Error('Request too large.');
  }
  const parsed=JSON.parse(body);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid request.');
  return parsed;
}

const fmtToronto=ts=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',dateStyle:'medium',timeStyle:'short'}).format(ts);

function buildAiContext(snapshot,account) {
  const projected=project(snapshot,account);
  const {state,catalog}=projected;
  const siteMap=new Map((catalog?.sites||[]).map(s=>[s.id,s]));
  const base={user:{id:account.id,name:account.name,role:account.role},simulatedNowToronto:fmtToronto(state.now)};
  if(account.role==='guard'){
    return {
      ...base,
      profile:state.profile,
      etaMinutes:state.eta,
      shifts:state.requests.slice(0,25).map(r=>({
        id:r.id,
        start:fmtToronto(r.start),
        end:fmtToronto(r.end),
        rush:r.rush,
        assigned:Boolean(r.mine),
        canVolunteer:Boolean(r.canVolunteer),
        offerStatus:r.offer?.status||null,
        location:r.location
      })),
      swaps:state.swaps,
      poolSwapsCount:state.poolSwaps.length,
      leaves:state.leaves.map(l=>({id:l.id,start:fmtToronto(l.start),end:fmtToronto(l.end),status:l.status}))
    };
  }
  if(account.role==='client'){
    return {
      ...base,
      company:Object.values(catalog?.clients||{})[0]||account.name,
      sites:(catalog?.sites||[]).map(s=>({id:s.id,name:s.name,area:s.area,uniform:s.uniform})),
      requests:state.requests.slice(0,25).map(r=>({
        id:r.id,
        site:siteMap.get(r.site)?.name||r.site,
        start:fmtToronto(r.start),
        end:fmtToronto(r.end),
        needed:r.need,
        confirmed:r.confirmed,
        rush:r.rush,
        supervisors:r.supervisors||0
      }))
    };
  }
  const open=state.requests.filter(r=>r.need>r.assignments.length&&r.start>state.now).sort((a,b)=>Number(b.rush)-Number(a.rush)||a.start-b.start);
  return {
    ...base,
    totalRequests:state.requests.length,
    understaffedCount:open.length,
    openRequests:open.slice(0,25).map(r=>({
      id:r.id,
      site:siteMap.get(r.site)?.name||r.site,
      start:fmtToronto(r.start),
      end:fmtToronto(r.end),
      needed:r.need,
      assigned:r.assignments.length,
      openSlots:Math.max(0,r.need-r.assignments.length),
      rush:r.rush,
      supervisorsNeeded:Math.max(0,(r.supervisors||0)-r.assignments.filter(a=>a.post==="Supervisor").length),
      escalated:Boolean(r.escalated),
      followUp:r.followUp||null
    })),
    pendingLeaves:state.leaves.filter(l=>l.status==='Pending').length,
    pendingSwaps:state.swaps.filter(s=>s.status==='Pending').length,
    recentLog:state.log.slice(0,8).map(entry=>({at:fmtToronto(entry.at),message:entry.message}))
  };
}

function resolveAiProvider() {
  if(process.env.GEMINI_API_KEY)return {type:'gemini',key:process.env.GEMINI_API_KEY,model:process.env.SIGMA_AI_MODEL||'gemini-2.5-flash'};
  if(process.env.GROQ_API_KEY)return {type:'openai',url:'https://api.groq.com/openai/v1/chat/completions',key:process.env.GROQ_API_KEY,model:process.env.SIGMA_AI_MODEL||'llama-3.3-70b-versatile'};
  if(process.env.OPENROUTER_API_KEY)return {type:'openai',url:'https://openrouter.ai/api/v1/chat/completions',key:process.env.OPENROUTER_API_KEY,model:process.env.SIGMA_AI_MODEL||'openrouter/free'};
  if(process.env.MISTRAL_API_KEY)return {type:'openai',url:'https://api.mistral.ai/v1/chat/completions',key:process.env.MISTRAL_API_KEY,model:process.env.SIGMA_AI_MODEL||'mistral-small-latest'};
  if(process.env.SIGMA_AI_KEY)return {type:'openai',url:process.env.SIGMA_AI_URL||'https://api.groq.com/openai/v1/chat/completions',key:process.env.SIGMA_AI_KEY,model:process.env.SIGMA_AI_MODEL||'llama-3.3-70b-versatile'};
  return null;
}

async function askLlm(provider,systemPrompt,history,prompt) {
  if(provider.type==='gemini'){
    const contents=[
      ...history.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),
      {role:'user',parts:[{text:prompt}]}
    ];
    const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent`;
    const response=await fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':provider.key},
      body:JSON.stringify({system_instruction:{parts:[{text:systemPrompt}]},contents,generationConfig:{temperature:0.3,maxOutputTokens:400}}),
      signal:AbortSignal.timeout(20000)
    });
    const payload=await response.json();
    if(!response.ok)throw Error(payload?.error?.message||'Gemini API request failed.');
    return payload?.candidates?.[0]?.content?.parts?.map(p=>p.text).join('').trim()||'No response generated.';
  }
  const messages=[{role:'system',content:systemPrompt},...history,{role:'user',content:prompt}];
  const response=await fetch(provider.url,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+provider.key},
    body:JSON.stringify({model:provider.model,messages,temperature:0.3,max_tokens:400}),
    signal:AbortSignal.timeout(20000)
  });
  const payload=await response.json();
  if(!response.ok)throw Error(payload?.error?.message||'AI provider request failed.');
  return payload?.choices?.[0]?.message?.content?.trim()||'No response generated.';
}

const server=http.createServer(async (req,res)=>{
  try{
    if(!hosts.has(req.headers.host))return send(res,403,{error:'Use the configured app address.'});
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method==='GET'&&files.has(url.pathname)){
      const [name,type]=files.get(url.pathname);
      const asset=fs.readFileSync(path.join(__dirname,name));
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(asset);
    }
    const post=req.method==='POST';
    const origin=req.headers.origin;
    if(post&&(!origins.has(origin)||new URL(origin).host!==req.headers.host||req.headers['content-type']!=='application/json'))return send(res,403,{error:'Open the app on its configured address.'});
    const secure=post&&origin.startsWith('https:');
    const token=sessionToken(req);
    if(post&&url.pathname==='/api/login'){
      const {login,password}=await readBody(req);
      if(typeof login!=='string'||typeof password!=='string'||login.length>160||password.length>256)return send(res,400,{error:'Enter your account and password.'});
      const now=Date.now();
      for(const [key,limit] of attempts)if(limit.until<=now)attempts.delete(key);
      const ip=req.socket.remoteAddress;
      const limit=attempts.get(ip)||{until:now+60000,failures:0};
      if(limit.failures>=12)return send(res,429,{error:'Too many sign-in attempts. Try again in a minute.'}, {'Retry-After':'60'});
      const user=findUser.get(loginKey(login));
      const check=scryptSync(password,user?.salt||dummySalt,64);
      if(!timingSafeEqual(check,user?.password_hash||dummyHash)||!user){
        limit.failures++;
        attempts.set(ip,limit);
        return send(res,401,{error:'Check your account and password.'});
      }
      if(token)deleteSession.run(hashToken(token));
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
      const nextToken=randomBytes(32).toString('hex');
      createSession.run(hashToken(nextToken),user.id,now+lifetime*1000);
      return send(res,200,{account:identity(user)},{'Set-Cookie':cookie(nextToken,lifetime,secure)});
    }
    if(post&&url.pathname==='/api/logout'){
      if(token)deleteSession.run(hashToken(token));
      return send(res,204,undefined,{'Set-Cookie':cookie('',0,secure)});
    }
    const user=token&&findSession.get(hashToken(token),Date.now());
    if(!user)return send(res,401,{error:'Sign in to continue.'});
    const account=identity(user);
    if(url.pathname==='/api/push'&&account.role==='guard'){
      if(!post&&req.method==='GET')return send(res,200,{publicKey:push.publicKey});
      if(post){
        const {endpoint}=await readBody(req);
        if(endpoint===null)push.remove(hashToken(token));
        else push.register(hashToken(token),endpoint);
        return send(res,204);
      }
    }
    if(post&&url.pathname==='/api/chat'){
      const body=await readBody(req);
      const prompt=typeof body.prompt==='string'?body.prompt.trim():'';
      if(!prompt||prompt.length>500)return send(res,400,{error:'Enter a message up to 500 characters.'});
      const provider=resolveAiProvider();
      if(!provider)return send(res,200,{configured:false,reply:null});
      const history=Array.isArray(body.history)?body.history.filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string').slice(-8).map(m=>({role:m.role,content:m.content.slice(0,500)})):[];
      const row=read.get();
      const context=buildAiContext(JSON.parse(row.state),account);
      const systemPrompt=`You are Ask Sigma, the assistant inside Sigma Dispatch Operations (a security guard staffing system). Answer concisely and accurately using ONLY the live workspace JSON below. Do not invent shifts, guards, or sites. If the user wants to perform a workspace action (like requesting leave, changing preferences, or submitting a staffing request), tell them the exact phrase they can type so the quick-action card appears.

Live workspace for ${account.name} (${account.role}):
${JSON.stringify(context)}`;
      const reply=await askLlm(provider,systemPrompt,history,prompt);
      return send(res,200,{configured:true,reply});
    }
    if(!((req.method==='GET'&&url.pathname==='/api/state')||(post&&url.pathname==='/api/actions')))return send(res,404,{error:'Unknown path.'});
    if(req.method==='GET'){
      const row=read.get();
      if(url.searchParams.get('since')===String(row.revision)&&url.searchParams.get('account')===String(account.id))return send(res,204);
      return send(res,200,{revision:row.revision,account,...workspace(JSON.parse(row.state),account,token)});
    }
    const command=await readBody(req);
    const row=read.get();
    const conflict={error:'The schedule changed. Review the updated board and try again.'};
    if(command.revision!==row.revision||command.account!==account.id)return send(res,409,conflict);
    const parsedState=JSON.parse(row.state);
    const result=execute(parsedState,command,account);
    if(!save.run(JSON.stringify(result.state),row.revision).changes)return send(res,409,conflict);
    for(const request of result.state.requests.filter(r=>r.rush&&Object.values(r.offers).some(o=>o.status==="Invited"))){

      const previous=parsedState.requests.find(r=>r.id===request.id);
      push.wave(request,previous?.offers||{}).catch(()=>console.warn("Rush notification dispatch failed."));
    }
    send(res,200,{...result,...workspace(result.state,account,token),account,revision:row.revision+1});
  }catch(error){send(res,400,{error:error.message});}
});

server.on('error',error=>{console.error('Could not start Sigma Dispatch.',error.message);process.exitCode=1;});
server.listen(port,host,()=>{
  const address=process.env.SIGMA_ORIGIN||'http://127.0.0.1:'+port;
  console.log('Sigma Dispatch is running at '+address);
  if(process.platform==='win32'&&process.argv.includes('--open')){
    execFile('rundll32.exe',['url.dll,FileProtocolHandler',address],{windowsHide:true},error=>{
      if(error)console.error('Open Sigma Dispatch at '+address);
    });
  }
});
