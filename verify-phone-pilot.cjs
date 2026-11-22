'use strict';
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {randomBytes}=require('node:crypto');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {rm}=require('node:fs/promises');
const {DatabaseSync}=require('node:sqlite');
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const port=Number(process.env.SIGMA_TEST_PORT||4308);
const origin='http://127.0.0.1:'+port;
const file=path.join(tmpdir(),'sigma-qr-test-'+randomBytes(6).toString('hex')+'.sqlite');
const pilot=randomBytes(24).toString('hex');
const gps={latitude:43.58,longitude:-79.64,accuracy:15};
async function run(){
  const server=spawn(process.execPath,['server.js'],{cwd:__dirname,windowsHide:true,env:{...process.env,SIGMA_DB:file,SIGMA_PORT:String(port),SIGMA_HOST:'127.0.0.1',SIGMA_ORIGIN:origin,SIGMA_PILOT_KEY:pilot}});
  let browser;
  try{
    await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('Test server exited early.')})]);
    const db=new DatabaseSync(file);
    const board=JSON.parse(db.prepare('SELECT state FROM board WHERE id=1').get().state);
    const shift=board.requests.find(r=>r.id===2);
    shift.start=Date.now()+5*60000;
    shift.need=2;
    shift.assignments.push({guard:3009,post:'General',at:Date.now()});
    db.prepare('UPDATE board SET state=?').run(JSON.stringify(board));
    db.close();
    browser=await chromium.launch({headless:true,channel:'msedge'});
    async function login(id,role){
      const context=await browser.newContext({viewport:{width:420,height:900},geolocation:gps,permissions:['geolocation']});
      const page=await context.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(origin);
      await page.locator('#login-name').fill(String(id));
      await page.locator('#login-password').fill(role+'-'+id+'-demo');
      await page.locator('#pilot-key').fill(pilot);
      await page.locator('#login button').click();
      await page.locator('[data-action=logout]').waitFor();
      return page;
    }
    const admin=await login(1001,'Admin');
    await admin.locator('#queue-results [data-action=select][data-id="2"]').click();
    await admin.locator('#attendance-pin summary').click();
    await admin.locator('#save-attendance-pin [name=latitude]').fill(String(gps.latitude));
    await admin.locator('#save-attendance-pin [name=longitude]').fill(String(gps.longitude));
    await admin.getByRole('button',{name:'Save site pin'}).click();
    await admin.getByText('Attendance site pin saved.').waitFor();
    const supervisor=await login(3019,'Guard');
    await supervisor.locator('#crew-2 summary').click();
    await supervisor.getByRole('button',{name:'Show attendance QR'}).click();
    const image=await supervisor.getByRole('img',{name:'Scan this QR to check in to the shift'}).getAttribute('src');
    const guard=await login(3009,'Guard');
    await guard.evaluate(image=>{
      navigator.mediaDevices.getUserMedia=async()=>{
        const qr=new Image();qr.src=image;await qr.decode();
        const canvas=document.createElement('canvas');
        canvas.width=canvas.height=480;
        const ctx=canvas.getContext('2d');
        ctx.fillStyle='white';ctx.fillRect(0,0,480,480);
        ctx.drawImage(qr,60,60,360,360);
        const stream=canvas.captureStream(10);
        setTimeout(()=>ctx.drawImage(qr,60,60,360,360),50);
        return stream;
      };
    },image);
    await guard.getByRole('button',{name:'Scan supervisor QR'}).click();
    await guard.getByRole('button',{name:'Verify location and check in'}).waitFor();
    await guard.context().setGeolocation({latitude:44,longitude:-79.64,accuracy:15});
    await guard.getByRole('button',{name:'Verify location and check in'}).click();
    await guard.getByText(/outside|inside the attendance area/i).waitFor();
    await guard.context().setGeolocation(gps);
    await guard.getByRole('button',{name:'Verify location and check in'}).click();
    await guard.getByText('Check-in verified with supervisor QR and location.').waitFor();
    assert.equal(await guard.evaluate(()=>byId(2).mine.checkIn.method),'qr-location');
    await supervisor.getByRole('button',{name:'Close',exact:true}).click();
    await supervisor.locator('dialog.attendance-dialog').waitFor({state:'detached'});
    await supervisor.locator('#review-2-3009').getByText(/QR attendance verified/).waitFor();
    await supervisor.locator('#review-2-3009 textarea').fill('Guard completed the entrance briefing.');
    const saved=supervisor.waitForResponse(response=>response.url().endsWith('/api/actions'));
    await supervisor.locator('#review-2-3009').evaluate(form=>form.requestSubmit());
    const result=await saved;
    if(!result.ok())throw Error('Supervisor review returned HTTP '+result.status()+': '+await result.text());
    await supervisor.getByText('Supervisor feedback saved for dispatch.').waitFor();
    await admin.getByText('Supervisor fit reviews · 1').waitFor();
    console.log('Shared server passed pilot login, site pin, supervisor QR, camera scan, off-site rejection, on-site attendance, and supervisor review.');
  }finally{
    if(browser)await browser.close();
    if(server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}
    await rm(file,{force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1});
