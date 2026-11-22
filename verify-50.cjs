const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {chromium}=require('playwright');
const port=Number(process.env.SIGMA_TEST_PORT||4297);
const origin='http://127.0.0.1:'+port;
const clientIds=[2001,2002];
async function run(){
  const server=spawn(process.execPath,['server.js'],{cwd:__dirname,windowsHide:true,env:{...process.env,SIGMA_DB:':memory:',SIGMA_PORT:String(port),SIGMA_HOST:'127.0.0.1',SIGMA_ORIGIN:origin}});
  let browser;
  try{
    await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw Error('Isolated test server failed to start');})]);
    browser=await chromium.launch({channel:'msedge',headless:true});
    async function session(){
      const context=await browser.newContext();
      const page=await context.newPage();page.setDefaultTimeout(30000);
      page.on('dialog',dialog=>dialog.accept());
      page.on('pageerror',error=>console.error(error));
      await page.goto(origin);return page;
    }
    async function login(p,id,role){
      if(await p.locator('[data-action=logout]').count())await p.locator('[data-action=logout]').click();
      await p.locator('#login-name').fill(String(id));await p.locator('#login-password').fill(role+'-'+id+'-demo');
      await p.locator('#login button').click();
      await p.locator('[data-action=logout]').waitFor();
      assert.equal(await p.evaluate(()=>account.id),id);
    }
    const admin=await session(),client=await session(),guard=await session();
    await login(admin,1001,'Admin');
    console.log('Dispatch signed in. Starting 50 bookings.');
    for(let i=0;i<50;i++){
      if(i%25===0)await login(client,clientIds[i/25],'Client');
      const rush=i%2===0, note='Booking '+String(i+1).padStart(2,'0');
      await client.evaluate(()=>refresh());
      const form=client.locator('#create-request');
      await client.locator('#request-compose').evaluate(el=>el.open=true);
      const fields=await client.evaluate(({rush,i})=>{
        if(!rush)return {date:calendarDate(inputDate(Date.now()),1),time:'17:'+String(i).padStart(2,'0')};
        const when=Date.now()+(65+i)*60000;
        return {date:inputDate(when),time:inputTime(when)};
      },{rush,i});
      for(const [name,v] of Object.entries({...fields,notes:note,dress:'Black closed-toe shoes',hours:String(1+i%3)}))await form.locator('[name='+name+']').fill(v);
      await form.locator('[name=source]').selectOption(['Portal','Phone','Email'][i%3]);
      const booking=client.waitForResponse(r=>r.url().endsWith('/api/actions'));
      await form.locator('button.primary').click();
      const submitted=await booking;
      if(!submitted.ok())throw Error(note+' submission: '+await submitted.text());
      await client.waitForFunction(n=>data.requests.some(r=>r.notes===n),note);
      const receipt=await client.evaluate(n=>data.requests.find(r=>r.notes===n),note);
      assert.equal(receipt.dress,'Black closed-toe shoes');
      assert.equal(receipt.source,['Portal','Phone','Email'][i%3]);
      assert(receipt.timeline.some(e=>e.status==='Received'));
      assert.equal(receipt.rush,rush,note+' priority');
      const id=receipt.id;
      await admin.evaluate(()=>refresh());
      await admin.waitForFunction(id=>!!byId(id),id);
      await admin.locator('#week-board').evaluate(el=>el.open=true);
      const shiftWeek=await admin.evaluate(id=>{
        const monday=date=>calendarDate(date,1-(new Date(date+'T12:00Z').getUTCDay()||7));
        return Math.round((Date.parse(monday(inputDate(byId(id).start)))-Date.parse(monday(inputDate(data.now))))/(7*day));
      },id);
      const shownWeek=await admin.evaluate(()=>view.weekOffset||0);
      if(shiftWeek!==shownWeek)await admin.locator('[data-action=week][data-id="'+Math.sign(shiftWeek-shownWeek)+'"]').click();
      await admin.locator('#week-board [data-action=select][data-id="'+id+'"]').first().click();
      if(i===0){
        await client.locator('#urgent-banner').getByText(/urgent staffing request.*awaiting coverage/).waitFor();
        await admin.locator('#urgent-banner').getByText(/urgent staffing request.*awaiting coverage/).waitFor();
        const listedGuard=await admin.evaluate(id=>availableForWave(byId(id))[0]?.id,id);
        assert(Number.isInteger(listedGuard),'Expected an eligible guard outside the first wave');
        await login(guard,listedGuard,'Guard');
        await guard.locator('#urgent-banner').getByText(/company-wide staffing alert.*available to you/).waitFor();
        await guard.getByRole('button',{name:'View available shifts'}).click();
        await guard.locator('.rush-banner [data-action=volunteer][data-id="'+id+'"]').waitFor();
        await guard.locator('.rush-banner').getByText('Open rush shift').waitFor();
        assert.equal(await guard.locator('.rush-banner [data-reply-deadline]').count(),0);
        await guard.locator('[data-action=guard-tab][data-id=shifts]').click();
        await guard.getByRole('button',{name:'Enable alert sound and vibration'}).click();
        await guard.reload();
        await guard.getByRole('button',{name:'Mute alert sound and vibration'}).waitFor();
        console.log('The site-wide rush alert appeared for client, dispatch and an eligible non-invitee.');
      }
      if(i===1){
        await client.locator('#urgent-banner').getByText(/booking.*open for staffing/).waitFor();
        await login(guard,3001,'Guard');
        await guard.waitForFunction(id=>data.companyAnnouncements.some(alert=>alert.id===id),id);
        assert.equal(await guard.evaluate(id=>data.requests.some(request=>request.id===id),id),false,'Ineligible guard should only receive a generic alert');
        const listedGuard=await admin.evaluate(id=>availableForWave(byId(id))[0]?.id,id);
        assert(Number.isInteger(listedGuard),'Expected an eligible guard for a future booking');
        await login(guard,listedGuard,'Guard');
        await guard.getByRole('button',{name:'View available shifts'}).click();
        await guard.locator('[data-action=decline][data-id="'+id+'"]').click();
        await guard.waitForFunction(id=>!data.companyAnnouncements.some(alert=>alert.id===id),id);
        await admin.waitForFunction(id=>Object.values(byId(id).offers).some(offer=>offer.status==='Declined'),id);
        console.log('A future booking alerted all guards, protected details and recorded an eligible decline.');
      }
      const guardId=await admin.evaluate(({id,rush})=>{
        const r=byId(id);return rush?Number(Object.keys(r.offers)[0]):availableForWave(r)[0]?.id;
      },{id,rush});
      assert(Number.isInteger(guardId),note+' should have an eligible guard');
      await login(guard,guardId,'Guard');
      await guard.locator('[data-action=guard-tab][data-id=open]').click();
      if(rush){
        assert(await guard.evaluate(id=>rushOffers().some(r=>r.id===id),id),note+' should have a live invitation');
        const offer=guard.locator('.rush-banner, .entry').filter({has:guard.locator('[data-action=volunteer][data-id="'+id+'"]')});
        await offer.locator('[data-reply-deadline]').first().waitFor();
      }
      const volunteerResponse=guard.waitForResponse(r=>r.url().endsWith('/api/actions'));
      await guard.locator('[data-action=volunteer][data-id="'+id+'"]').first().click();
      const response=await volunteerResponse;
      if(!response.ok())throw Error(note+' volunteer: '+await response.text());
      await guard.waitForFunction(id=>byId(id)?.offer?.status==='Volunteered',id);
      await admin.evaluate(()=>refresh());
      const approval=admin.waitForResponse(r=>r.url().endsWith('/api/actions'));
      await admin.locator('[data-action=approve][data-id="'+id+'"][data-extra="'+guardId+'"]').evaluate(button=>button.click());
      const approvalResult=await approval;
      if(!approvalResult.ok())throw Error(note+' approval: '+await approvalResult.text());
      await admin.waitForFunction(id=>byId(id)?.assignments.length===1,id);
      await Promise.all([client.evaluate(()=>refresh()),guard.evaluate(()=>refresh())]);
      await client.waitForFunction(id=>byId(id)?.confirmed===1,id);
      await guard.locator('[data-action=guard-tab][data-id=shifts]').click();
      await guard.locator('[data-action=ack][data-id="'+id+'"]').click();
      await guard.waitForFunction(id=>byId(id)?.mine?.ack,id);
      await admin.evaluate(()=>refresh());
      await admin.waitForFunction(id=>byId(id).assignments[0]?.ack,id);
      if(i%5===0){
        await admin.locator('#adjust-post').evaluate(el=>el.open=true);
        await admin.locator('#adjust-form [name=hours]').fill('3.5');
        await admin.locator('#adjust-form').evaluate(form=>form.requestSubmit());
        await admin.waitForFunction(id=>byId(id).need===0,id);
        assert.equal(await admin.evaluate(()=>byId(view.selected).assignments.length),0);
      }else if(i%5===1){
        await admin.locator('#assigned-briefs').evaluate(el=>el.open=true);
        await admin.locator('[data-action=cancel][data-id="'+id+'"]').click();
        await client.waitForFunction(id=>byId(id)?.confirmed===0,id);
      }else if(i%5===2){
        await admin.locator('#guard-record').evaluate(el=>el.open=true);
        await admin.locator('#find-record input').fill('3006');await admin.locator('#find-record button').click();
        assert.match(await admin.locator('#guard-record').innerText(),/Marked unavailable/);
        await admin.locator('#call-log select').selectOption('Unavailable');
        await admin.locator('#call-log').evaluate(form=>form.requestSubmit());
        await admin.waitForFunction(id=>byId(id).history.some(e=>e.guard===3006&&e.status==='Unavailable'),id);
      }
      console.log(note+' passed · '+(rush?'rush':'regular'));
    }
  }finally{if(browser)await browser.close();server.kill();}
}
run().catch(e=>{console.error(e);process.exitCode=1});







