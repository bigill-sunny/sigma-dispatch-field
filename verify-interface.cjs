const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
async function verifyInterface(){
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const url=pathToFileURL(path.join(__dirname,'Open Sigma Dispatch.html')).href;
    async function login(id,role){
      const page=await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror',error=>console.error(error));
      await page.clock.install();
      await page.goto(url);
      await page.locator('#login-name').fill(String(id));
      await page.locator('#login-password').fill(role+'-'+id+'-demo');
      await page.locator('#login button').click();
      await page.locator('[data-action=logout]').waitFor();
      return page;
    }
    const admin=await login(1001,'Admin');
    await admin.locator('#queue-results [data-action=select][data-id="1"]').click();
    await admin.locator('[data-action=wave]').click();
    await admin.locator('#invited').waitFor({state:'attached'});
    assert.equal(await admin.locator('#invited').evaluate(el=>el.open),false);
    const guardId=await admin.evaluate(()=>Object.keys(byId(1).offers)[0]);
    const guard=await login(guardId,'Guard');
    await guard.locator('.rush-banner [data-action=volunteer][data-id="1"]').click();
    await guard.getByText(/You volunteered. Wait/).waitFor();
    await admin.locator('[data-action=jump-review]').click();
    await admin.locator('[data-action=approve]').first().click();
    await guard.locator('[data-action=ack][data-id="1"]').click();
    await guard.waitForFunction(()=>data.requests.find(r=>r.id===1)?.mine?.ack);
    await admin.getByText(/1\/1 briefs acknowledged/).waitFor();
    await admin.locator('[data-action=escalate]').click();
    await admin.getByText(/Follow-up owned by/).waitFor();
    await admin.locator('.mobile-back').click();
    const client=await login(2001,'Client');
    await client.locator('#request-compose > summary').click();
    await client.locator('#create-request button.primary').click();
    await client.getByText(/Request submitted/).first().waitFor();
    await admin.locator('#queue-results [data-action=select][data-id="1"]').click();
    await admin.clock.fastForward(301000);
    await admin.locator('.decision-title').filter({hasText:'Wave expired'}).waitFor();
    console.log('Mobile handoff, acknowledgment, ownership, intake and live deadline checks passed.');
  }finally{await browser.close();}
}
verifyInterface().catch(error=>{console.error(error);process.exitCode=1});


