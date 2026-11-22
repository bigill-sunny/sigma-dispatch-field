let chatOpen=false;
let nextChatAction=0;
let chatHistory=[];
const chatActions=new Map();
const prompts={
  admin:['Which shifts still need guards?','Summarize today’s urgent requests'],
  guard:['When is my next shift?','Are there any extra shifts this week?','Request leave from Nov 25 to Nov 27','Set my preferred hours to mornings Mon–Fri'],
  client:['Need 6 guards tomorrow at 9am for 8 hours','How many guards are confirmed for today?']
};
const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function resetChat() {
  chatOpen=false;
  nextChatAction=0;
  chatHistory=[];
  chatActions.clear();
  document.querySelector('#chat').innerHTML='';
}
function renderChat() {
  const root=document.querySelector('#chat');
  if(!account||!prompts[view.role]){root.innerHTML='';return;}
  if(!root.firstElementChild){
    const intro=view.role==='admin'
      ?'Ask about open positions, urgent requests, or pending approvals.'
      :view.role==='guard'
      ?'Ask about shifts, time off, or working preferences.'
      :'Draft a staffing request or check today’s coverage.';
    root.innerHTML=`
      <section class="chat-drawer card" id="chat-drawer" aria-label="Ask Sigma" hidden>
        <div class="row"><h2>Ask Sigma</h2>${button('Close','chat-toggle')}</div>
        <div class="chat-messages" id="chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
        <div class="chat-suggestions" aria-label="Suggested questions">${chatPrompts().map((prompt,index)=>button(safe(prompt),'chat-prompt',index)).join('')}</div>
        <form id="chat-form" class="wrap"><label class="sr-only" for="chat-prompt">Message Ask Sigma</label><input id="chat-prompt" name="prompt" maxlength="500" placeholder="Ask Sigma anything…" required><button class="button primary">Send</button></form>
      </section>
      <button type="button" class="button primary chat-trigger" data-action="chat-toggle" aria-expanded="false" aria-controls="chat-drawer">Ask Sigma</button>`;
    addChatLine('sigma',intro);
  }
  root.querySelector('#chat-drawer').hidden=!chatOpen;
  root.querySelector('.chat-trigger').setAttribute('aria-expanded',String(chatOpen));
}

function chatPrompts() {
  if(view.role!=='client'||!sites[0])return prompts[view.role];
  const [request,coveragePrompt]=prompts.client;
  return [request.replace('tomorrow','at '+sites[0].name+' tomorrow'),coveragePrompt];
}
function addChatLine(from,content,body='') {
  const messages=document.querySelector('#chat-messages');
  if(!messages)return null;
  messages.insertAdjacentHTML('beforeend',`<article class="chat-line ${from}"><p>${safe(content)}</p>${body}</article>`);
  messages.scrollTop=messages.scrollHeight;
  return messages.lastElementChild;
}
function chatConfirmation(label,action,fields={},id='') {
  const key=++nextChatAction;
  chatActions.set(key,{action,id,fields});
  return button(label,'chat-confirm',key,'','primary');
}

function chatDate(text,reference) {
  if(/^\d{4}-\d{2}-\d{2}$/.test(text)){localTime(text,'00:00');return text;}
  const match=text.match(/^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i);
  if(!match)throw Error('Use a date like Nov 25 or 2026-11-25.');
  const month=months.indexOf(match[1].toLowerCase().slice(0,3))+1;
  if(!month)throw Error('Choose a valid month.');
  const suffix='-'+String(month).padStart(2,'0')+'-'+match[2].padStart(2,'0');
  let year=Number(match[3]||reference.slice(0,4));
  if(!match[3]&&year+suffix<reference)year++;
  const date=year+suffix;
  localTime(date,'00:00');
  return date;
}
function leavePrompt(prompt) {
  const match=prompt.match(/\bfrom\s+(.+?)\s+(?:to|through|until)\s+(.+?)[.!?]*$/i);
  if(!match)throw Error('Include both dates, for example “Request leave from Nov 25 to Nov 27”.');
  const first=chatDate(match[1],inputDate(data.now));
  const last=chatDate(match[2],inputDate(data.now));
  const range=leaveRange(first,last,data.now,data.leaves);
  addChatLine('sigma',`Request leave from ${formatDay(range.start)} through ${formatDay(range.end-1)}?`,chatConfirmation('Confirm leave request','leave-request',{first,last}));
}
function preferencesPrompt(prompt) {
  const preferred=blocks.filter(block=>new RegExp('\\b'+block.toLowerCase()+'s?\\b','i').test(prompt));
  const names=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const short='(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
  const span=prompt.match(new RegExp('\\b('+short+')\\s*(?:[-–—]|to|through)\\s*('+short+')\\b','i'));
  const dayIndex=value=>weekdays.findIndex(day=>day.toLowerCase()===value.toLowerCase().slice(0,3));
  let days=weekdays.filter((day,index)=>new RegExp('\\b(?:'+day+'|'+names[index]+')\\b','i').test(prompt));
  if(span){
    const start=dayIndex(span[1]),end=dayIndex(span[2]);
    days=Array.from({length:(end-start+7)%7+1},(_,offset)=>weekdays[(start+offset)%7]);
  }else if(/\bweekdays\b/i.test(prompt))days=weekdays.slice(0,5);
  else if(/\bweekends?\b/i.test(prompt))days=weekdays.slice(5);
  if(!preferred.length)throw Error('Choose Morning, Afternoon or Overnight, for example “Set my preferred hours to mornings Mon–Fri”.');
  const fields={...data.profile,days:days.length?days:data.profile.days,blocks:preferred};
  addChatLine('sigma',`Save ${fields.blocks.join(', ')} on ${fields.days.join(', ')||'no selected days'}? Your weekly target and rush setting stay as shown in Working hours.`,chatConfirmation('Save working preferences','preferences',fields));
}
function extraShiftsPrompt(prompt) {
  let available=guardOpenShifts();
  if(/\bthis week\b/i.test(prompt)){
    const today=inputDate(data.now);
    const weekday=(new Date(today+'T12:00Z').getUTCDay()+6)%7;
    const nextMonday=calendarDate(today,7-weekday);
    available=available.filter(r=>inputDate(r.start)<nextMonday);
  }
  if(!available.length){addChatLine('sigma','There are no eligible regular shifts in that period.');return;}
  const cards=available.map(r=>`<div class="entry"><strong>${safe(r.location.area)}</strong>
    <p class="sub">${shiftTime(r)} · ${safe(r.location.uniform)}</p>${chatConfirmation('Request shift','volunteer',{},r.id)}</div>`).join('');
  addChatLine('sigma',`I found ${available.length} eligible regular ${available.length===1?'shift':'shifts'}.`,cards);
}
function clientRequestPrompt(prompt) {
  const fields=parseRequestDraft(prompt);
  if(!fields.site||!fields.date||!fields.time||!fields.hours||!fields.count)throw Error('Include your site, number of guards, start date and time, and duration.');
  if(localTime(fields.date,fields.time)<=data.now)throw Error('Choose a future start time.');
  const site=siteBy(fields.site);
  const requirements=[fields.force?'Use of force / MORB':'',fields.vehicle?'Vehicle / lockbox':''].filter(Boolean);
  addChatLine('sigma',`${fields.count} guards at ${site.name} on ${formatDay(localTime(fields.date,fields.time))} at ${fields.time} for ${fields.hours} hours.${fields.supervisors?' Supervisor posts: '+fields.supervisors+'.':''}${requirements.length?' '+requirements.join(' · ')+'.':''}`,chatConfirmation('Submit request','create-request',fields));
}

function localFallbackHint() {
  if(view.role==='guard')return 'Ask about your next shift, extra shifts, leave dates, or preferred hours. (To enable open-ended AI answers, add a free API key to .env on the server.)';
  if(view.role==='client')return 'Ask about today’s coverage or describe a staffing request with a site, start, and duration. (To enable open-ended AI answers, add a free API key to .env on the server.)';
  return 'To enable AI answers for administrators, add a free API key (e.g. GROQ_API_KEY or GEMINI_API_KEY) to .env and restart the server.';
}

async function askSigmaAI(prompt) {
  if(location.protocol==='file:'||typeof offlineBundle!=='undefined'){
    addChatLine('sigma',localFallbackHint());
    return;
  }
  const accountId=account?.id;
  const role=view.role;
  const pendingLine=addChatLine('sigma','Thinking…');
  const sendBtn=document.querySelector('#chat-form button');
  if(sendBtn)sendBtn.disabled=true;
  try{
    const res=await fetch('/api/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt,history:chatHistory})
    });
    const result=await res.json();
    if(account?.id!==accountId||view.role!==role)return;
    const text=res.ok
      ?(result.configured&&result.reply?result.reply:localFallbackHint())
      :(result.error||'Could not reach Ask Sigma AI.');
    if(pendingLine)pendingLine.querySelector('p').textContent=text;
    if(res.ok&&result.configured&&result.reply){
      chatHistory.push({role:'user',content:prompt},{role:'assistant',content:result.reply});
      if(chatHistory.length>12)chatHistory=chatHistory.slice(-12);
    }
  }catch{
    if(pendingLine)pendingLine.querySelector('p').textContent='Could not reach the server AI endpoint.';
  }finally{
    if(sendBtn)sendBtn.disabled=false;
    const messages=document.querySelector('#chat-messages');
    if(messages)messages.scrollTop=messages.scrollHeight;
  }
}

function askSigma(prompt) {
  addChatLine('you',prompt);
  try{
    if(view.role==='guard'){
      if(/\b(next|upcoming|current)\b.*\bshift\b/i.test(prompt)){
        const next=guardAssignments()[0];
        addChatLine('sigma',next?`${next.location.name} · ${shiftTime(next)} · ${next.location.uniform} · ${briefStatus(next)}.`:'There are no current or upcoming confirmed shifts.');
        return;
      }
      if(/\b(extra|open|available|regular)\b.*\bshifts?\b/i.test(prompt)){extraShiftsPrompt(prompt);return;}
      if(/\b(?:leave|time off)\b/i.test(prompt)){leavePrompt(prompt);return;}
      if(/\b(?:prefer(?:red|ences?)?|working hours)\b/i.test(prompt)){preferencesPrompt(prompt);return;}
    }else if(view.role==='client'){
      if(/\b(?:confirmed|coverage|filled)\b/i.test(prompt)){
        const today=inputDate(data.now);
        const end=localTime(calendarDate(today,1),'00:00');
        const requests=requestsForClient().filter(r=>r.start<end&&r.end>data.now);
        addChatLine('sigma',requests.length?`Today: ${requests.reduce((n,r)=>n+confirmedCount(r),0)} of ${requests.reduce((n,r)=>n+r.need,0)} guards confirmed across ${requests.length} active ${requests.length===1?'request':'requests'}.`:'There are no active requests for your company today.');
        return;
      }
      if(/\b(?:guards?|coverage|request)\b/i.test(prompt)){clientRequestPrompt(prompt);return;}
    }
    askSigmaAI(prompt);
  }catch(error){addChatLine('sigma',error.message);}
}

function handleChatAction(action,id) {
  if(action==='chat-toggle'){
    chatOpen=!chatOpen;
    renderChat();
    document.querySelector(chatOpen?'#chat-prompt':'.chat-trigger')?.focus();
    return true;
  }
  if(action==='chat-prompt'){
    const prompt=chatPrompts()[Number(id)];
    if(prompt)askSigma(prompt);
    return true;
  }
  if(action==='chat-confirm'){
    const pending=chatActions.get(Number(id));
    const control=document.querySelector(`[data-action=chat-confirm][data-id="${Number(id)}"]`);
    if(pending&&control&&!busy){
      control.disabled=true;
      const accountId=account.id;
      submitAction(pending.action,pending.id,'',pending.fields).then(success=>{
        if(account?.id!==accountId)return;
        if(success){
          chatActions.delete(Number(id));
          control.textContent='Confirmed';
          addChatLine('sigma','Saved. You can see the update in your workspace.');
        }else{
          control.disabled=false;
          addChatLine('sigma','That action could not be completed. Check the message in your workspace.');
        }
      });
    }
    return true;
  }
  return false;
}
