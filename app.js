const button=(label,action,id='',extra='',style='')=>`<button type="button" class="button ${style}" data-action="${action}" data-id="${id}" data-extra="${extra}">${label}</button>`;
const tag=(label,style='')=>`<span class="tag ${style}">${label}</span>`;
const empty=(label)=>`<div class="empty">${label}</div>`;
const option=(value,label,selected)=>`<option value="${safe(value)}"${value===selected?' selected':''}>${safe(label)}</option>`;
const confirmedCount=r=>r.confirmed??r.assignments.length;
const statusOf=(r)=>r.need===0?tag('Rescheduled'):confirmedCount(r)===r.need?tag('Covered','good'):isPast(r)?tag('Coverage missed','rush'):r.replacement?tag('Replacement','rush'):r.rush?tag('Urgent','rush'):tag('Open');
const meter=(r)=>`<div class="progress" role="progressbar" aria-label="Confirmed guards" aria-valuenow="${confirmedCount(r)}" aria-valuemax="${r.need}"><div style="width:${r.need?100*confirmedCount(r)/r.need:0}%"></div></div>`;
const coverage=(r)=>`${confirmedCount(r)} of ${r.need} confirmed`;
const requestsForClient=()=>data.requests.filter(r=>siteBy(r.site).client===view.client);

function hero(role,title,description) {
  return `<div class="hero"><div><p class="eyebrow">${role}</p><h1>${title}</h1><p class="muted">${description}</p></div></div>`;
}

function render() {
  document.querySelector('#account').innerHTML=`<span>${safe(account.name)} · ${account.id}</span>${button('Sign out','logout')}`;
  const command=document.querySelector('#command');
  command.innerHTML='<span class="small muted">Toronto time</span><span class="clock">'+formatTime(Date.now())+'</span>';
  document.querySelector('#screen').innerHTML=({admin:adminView,guard:guardView,client:clientView})[view.role]();if(view.role==='client')priority();
  renderChat();
  updateRushCountdown();
}

function priority(){const f=document.querySelector('#create-request')?.elements;if(!f)return;let note='';try{const diff=localTime(f.date.value,f.time.value)-data.now;note=diff<=0?'Choose a future start.':diff<=2*hour?'Starts within two hours. Automatically flagged as urgent.':f.rush.value==='urgent'?'Urgent dispatch requested.':'Regular dispatch.';}catch{}document.querySelector('#priority-note').textContent=note;}
document.addEventListener('input',priority);
function announce(message,error=false) {
  document.querySelector('#notice').innerHTML=message?`<p class="notice${error?' error':''}">${safe(message)}</p>`:'';
}

function adminView() {
  const active=data.requests.filter(r=>!isPast(r));
  const metrics=[['Open positions',active.reduce((sum,r)=>sum+open(r),0)],['Urgent requests',active.filter(r=>r.rush&&open(r)).length],['Awaiting review',active.reduce((sum,r)=>sum+waiting(r),0)+[...data.leaves,...data.swaps].filter(x=>x.status==='Pending').length]];
  const r=byId(view.selected);
  return `${hero('Administrator','Dispatch board','Review coverage, approve assignments, and manage schedule changes.')}
    <div class="stats secondary-metrics">${metrics.map(([label,value])=>`<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}</div>
    ${weekBoard()}<div class="grid dispatch-grid ${view.mobileDetail?"detail-open":""}"><div class="queue-column"><section class="card"><div class="section-top"><h2>Coverage queue</h2><select id="status-filter" aria-label="Filter coverage">${option('all','All requests',view.status)}${option('open','Open',view.status)}${option('rush','Urgent',view.status)}${option('covered','Covered',view.status)}</select></div><input type="search" id="queue-search" placeholder="Search sites" aria-label="Search sites" value="${safe(view.search)}"><div class="stack" id="queue-results" style="margin-top:10px">${queueResults()}</div></section>${changePanel()}</div>
    <div class="request-column">${button("Back to queue","back-queue","","","mobile-back")}<div id="decision">${r?requestPanel(r):empty('Select a request to review coverage.')}</div>${activityPanel()}</div></div>`;
}

function queueDecision(r){
  if(!r.need)return 'Rescheduled';
  if(!open(r))return r.assignments.filter(a=>!a.ack).length+' briefs unread';
  if(isPast(r))return 'Coverage missed';
  const offers=Object.values(r.offers);
  if(waiting(r))return waiting(r)+' awaiting review';
  if(offers.some(activeOffer))return 'Awaiting guard replies';
  if(offers.some(o=>o.status==='Invited'))return 'Wave expired · follow up';
  return gap(r)?gap(r)+' supervisor needed':open(r)+' positions open';
}

function queueResults() {
  const list=data.requests.filter(r=>{
    const statusMatches=view.status==='all'||view.status==='open'&&open(r)||view.status==='rush'&&r.rush&&open(r)||view.status==='covered'&&!open(r);
    return statusMatches&&siteBy(r.site).name.toLowerCase().includes(view.search.toLowerCase());
  }).sort((a,b)=>Number(Boolean(open(b)&&b.rush&&!isPast(b)))-Number(Boolean(open(a)&&a.rush&&!isPast(a)))||a.start-b.start);
  const pageSize=6;
  const offset=view.page*pageSize;
  if(!list.length) return empty('No requests match these filters.');
  return list.slice(offset,offset+pageSize).map(r=>`<button type="button" class="list-button" data-action="select" data-id="${r.id}" aria-pressed="${r.id===view.selected}"><span class="row"><strong>${siteBy(r.site).name}</strong>${statusOf(r)}</span><span class="row muted small"><span>${formatDay(r.start)} · ${formatTime(r.start)}</span><span>${coverage(r)}</span></span><strong class="small">${queueDecision(r)}</strong> ${r.followUp&&open(r)?'<span class="small">Follow-up: '+safe(r.followUp.owner)+' · '+(r.followUp.due<=data.now?'due now':formatTime(r.followUp.due))+'</span>':''}</button>`).join('')+(list.length>pageSize?`<div class="row small muted"><span>${offset+1}–${Math.min(offset+pageSize,list.length)} of ${list.length}</span><span class="actions">${view.page?button('Previous','page',-1):''}${offset+pageSize<list.length?button('Next','page',1):''}</span></div>`:'');
}

function requestPanel(r) {
  const site=siteBy(r.site);
  const remaining=Math.floor((r.start-data.now)/minute);
  const pool=availableForWave(r);
  if(gap(r))pool.sort((a,b)=>Number(b.tier===2)-Number(a.tier===2));
  const preferred=pool.filter(g=>preferenceMatches(g,r,scheduleCheck(g,r).projected)).length;
  const volunteers=sortedGuards(r).filter(g=>offerFor(r,g)?.status==='Volunteered');
  const sent=Object.values(r.offers).filter(o=>o.expires).length;
  const invited=Object.values(r.offers).filter(activeOffer).length;
  const selected=volunteers.filter(g=>view.checked.has(g.id));
  const unread=r.assignments.filter(a=>!a.ack).length;
  const outstanding=Object.values(r.offers).filter(activeOffer);
  const deadline=outstanding.length?Math.min(...outstanding.map(o=>Math.min(o.expires,o.replyDeadline||Infinity))):0;
  const expired=Object.values(r.offers).some(o=>o.status==='Invited'&&!activeOffer(o));
  const reviewable=volunteers.filter(g=>!eligibility(g,r).length);
  const headline=!open(r)?(unread?unread+' site brief'+(unread===1?'':'s')+' awaiting acknowledgment':'All assigned guards acknowledged the brief'):isPast(r)?'Shift started with a vacancy':reviewable.length?'Review '+reviewable.length+' volunteer'+(reviewable.length===1?'':'s'):invited?'Waiting for replies until '+formatTime(deadline):expired?'Wave expired · 0 active replies':gap(r)?gap(r)+' supervisor needed':open(r)+' positions to fill';
  const blocker=r.escalated?(r.followUp?'Follow-up owned by '+safe(r.followUp.owner)+' · '+(r.followUp.due<=data.now?'due now':'due by '+formatTime(r.followUp.due)):'Manual follow-up flagged · owner needed.'):!open(r)?'Coverage complete. Confirmed guards can see site instructions.':isPast(r)?'Shift started with unfilled positions.':!pool.length&&!invited&&!volunteers.length?'No eligible replies or new guards. Take follow-up.':'';
  return `<section class="card"><div class="section-top"><div><div class="wrap">${statusOf(r)}${remaining>0&&remaining<=120&&open(r)?tag(`${remaining} min to start`,'warn'):''}</div><h2 style="margin-top:8px">${site.name}</h2><strong class="decision-title">${headline}</strong><p class="sub">${shiftTime(r)} · ${tiers[r.tier]} or higher · ${site.uniform}</p>${r.dress?`<p class="sub">Dress code � ${safe(r.dress)}</p>`:''}${r.source?`<p class="sub">Received via ${safe(r.source)}</p>`:''}${r.contact?`<p class="sub">Requested by ${safe(r.contact)}</p>`:''}</div></div>
  <div class="row"><strong>${coverage(r)}</strong><span class="muted small">${open(r)} open · ${gap(r)} supervisor needed · ${sent} invited · ${invited} awaiting reply · ${r.assignments.length-unread}/${r.assignments.length} briefs acknowledged</span></div>${meter(r)}
  ${r.force||r.vehicle?tag([r.force?'Use-of-force check':'',r.vehicle?'Vehicle / key / lockbox check':''].filter(Boolean).join(' · '),'warn'):''}${blocker?`<p class="sub">${blocker}</p>`:''}
  ${r.replacement&&gap(r)&&!isPast(r)?`<p class="sub">${gap(r)===1?'A replacement supervisor is required.':`${gap(r)} replacement supervisors are required.`}</p>`:''}
  <div class="actions form-actions">${reviewable.length?button('Review volunteers','jump-review',r.id,'','primary'):!open(r)&&unread?button('Check unread briefs','jump-briefs',r.id,'','primary'):''}${open(r)&&!isPast(r)&&pool.length?button(r.rush?'Send offer wave':'Send regular offers','wave',r.id,'',reviewable.length||invited?'':'primary'):''}${open(r)&&r.followUp?.owner!==account.name?button(r.followUp?'Take over follow-up':'Take follow-up','escalate',r.id):''}</div>
   ${invited?'<details class="details" id="invited"><summary>Invited guards · '+invited+'</summary><div class="wrap">'+Object.entries(r.offers).filter(([,o])=>activeOffer(o)).map(([id])=>tag(guardBy(id).name+' · '+id+' · '+(data.phoneGuards?.includes(Number(id))?'Phone registered':'No registered phone'))).join('')+'</div></details>':''}
  <hr class="divider"><div class="section-top"><div><h3 id="volunteer-review" tabindex="-1">Volunteers to review</h3><p class="sub">${r.rush?'Ranked by estimated travel time, then reliability.':'Ranked by reliability, then estimated travel time.'} Area travel estimates and on-time records use fictional data.</p><p class="sub">Rest checks and schedule-history flags can block approval. Projected overtime is shown before approval.</p></div>${selected.length?button(`Approve selected (${selected.length})`,'batch',r.id,'','primary'):''}</div>
  ${volunteers.length?`<div class="table-wrap"><table><thead><tr><th scope="col">Guard</th><th scope="col">Travel</th><th scope="col">Reliability</th><th scope="col">Hours on this board</th><th scope="col">Preferences</th><th scope="col">Decision</th></tr></thead><tbody>${volunteers.map(g=>{
    const reasons=eligibility(g,r);
    const {projected,ot}=scheduleCheck(g,r);
    const matches=preferenceMatches(g,r,projected);
    return `<tr><td>${!reasons.length?`<input type="checkbox" class="pick" aria-label="Select ${g.name}" value="${g.id}" ${view.checked.has(g.id)?'checked':''}> `:''}<strong>${g.name}</strong><br><span class="muted">${tiers[g.tier]}</span></td><td>Est. ${travelMinutes(g,r)} min · ${remaining-travelMinutes(g,r)<=10?tag((remaining-travelMinutes(g,r))+" min margin · verify arrival","warn"):(remaining-travelMinutes(g,r))+" min margin"}</td><td>${attendance(g).onTime}/${attendance(g).completed} on time</td><td>${projected} h projected<br>${ot?tag(`${ot} h added overtime`,'warn'):'0 h added overtime'}</td><td>${tag(matches?'Match':'Outside target',matches?'good':'')}</td><td>${reasons.length?tag(reasons[0],'warn'):button('Approve','approve',r.id,g.id)}</td></tr>`;
  }).join('')}</tbody></table></div>`:empty('Responses will appear here for administrator approval.')}
  ${open(r)&&!isPast(r)?`<details id="eligibility" class="details"><summary>Eligibility checks</summary><p class="sub">${preferred} of ${pool.length} available for the next wave match their working preferences.</p><p class="sub">${guards.filter(g=>eligibility(g,r).length).length} distinct guards excluded. Reasons may overlap.</p>${exclusionSummary(r)}</details>`:''}
  ${operationsTools(r)}${r.assignments.length?`<details id="assigned-briefs" class="details"><summary>Confirmed assignments · ${r.assignments.length}</summary>${r.assignments.map(a=>`<div class="row entry small"><span>${guardBy(a.guard).name} · ${a.post||tiers[r.tier]} · ${a.guard}</span><span>${a.ack?'Brief acknowledged at '+formatTime(a.ack):'Brief unread'} · ${formatTime(a.at)} ${!isPast(r)?button('Remove assignment','cancel',r.id,a.guard,'danger'):''}</span></div>`).join('')}</details>`:''}</section>`;
}

function exclusionSummary(r) {
  const sample=guards.filter(g=>eligibility(g,r).length);
  const groups={};
  for(const g of sample) for(const reason of eligibility(g,r)) groups[reason]=(groups[reason]||0)+1;
  return `<div class="wrap">${Object.entries(groups).map(([label,count])=>tag(`${label} · ${count}`)).join('')||tag('All guards eligible','good')}</div>`;
}

function changePanel() {
  const pending=[...data.leaves.map(x=>({...x,type:'leave'})),...data.swaps.map(x=>({...x,type:'swap'}))].filter(x=>x.status==='Pending');
  return `<section class="card"><div class="section-top"><h2>Schedule changes</h2>${tag(pending.length+' pending')}</div>${pending.length?pending.map(x=>`<div class="entry"><strong>${guardBy(x.guard).name}</strong><p class="sub">${x.type==='leave'?`Leave · ${formatDay(x.start)}–${formatDay(x.end-day)}`:`Swap to ${(guardBy(x.target)?.name||'eligible pool')} · ${x.accepted?'accepted by guard':'awaiting guard acceptance'} · ${shiftTime(byId(x.shift))}`}</p><div class="actions">${x.type==='leave'||x.accepted?button('Approve','accept-change',x.id,x.type,'primary'):''}${button('Decline','deny-change',x.id,x.type)}</div></div>`).join(''):empty('New leave and swap requests will appear here.')}</section>`;
}

function activityPanel() {
  return `<section class="card"><div class="section-top"><h2>Activity log</h2></div><div class="activity">${data.log.map(a=>`<div class="entry small"><strong>${formatTime(a.at)}</strong> <span class="muted">${safe(a.message)}</span></div>`).join('')}</div></section>`;
}

function clientView() {
  const list=requestsForClient().sort((a,b)=>Number(b.end>data.now)-Number(a.end>data.now)||Number(b.confirmed<b.need)-Number(a.confirmed<a.need)||a.start-b.start);
  const f=view.prefill;
  const visibleSites=sites.filter(s=>s.client===view.client);
  return `${hero('Client','Request coverage','Submit coverage needs and track confirmations for your sites.')}
  <div class="grid equal">  <section class="card"><div class="section-top"><h2>${clients[view.client]} requests</h2></div><div class="stack">${list.length?list.map(r=>`<div class="list-button"><div class="row"><strong>${siteBy(r.site).name}</strong>${statusOf(r)}</div><p class="sub">${shiftTime(r)}</p>${meter(r)}<p class="sub">${safe(r.progress||"Received")}${r.updated?" · "+formatDay(r.updated)+" "+formatTime(r.updated):""}</p><div class="row small"><strong>${coverage(r)}${r.supervisorGap?' · '+r.supervisorGap+' supervisor outstanding':''}</strong>${button('Repeat request','repeat',r.id)}</div>${r.timeline?.length?`<details><summary>Coverage timeline</summary>${r.timeline.map(e=>`<p>${formatDay(e.at)} � ${formatTime(e.at)} � ${safe(e.status)}</p>`).join('')}</details>`:''}</div>`).join(''):empty('Your submitted requests will appear here.')}</div></section><details id="request-compose" class="card" ${view.template?"open":""}><summary>Request more guards</summary><div class="section-top"><h2>${view.template?'Repeat a request':'New request'}</h2><span class="small muted">${safe(account.name)}</span></div>
  <details class="details"><summary>Paste fictional client email</summary><textarea id="email" rows="3" aria-label="Client email" placeholder="Need 10 extra guards at Maple in two hours for 4 hours"></textarea> ${button("Extract draft","extract")}</details><form id="create-request"><div class="fields"><label class="full">Site<select name="site" required>${visibleSites.map(s=>option(s.id,s.name,f.site)).join('')}</select></label>
  <label>Start date<input type="date" name="date" min="${inputDate(data.now)}" value="${inputDate(data.now+2*hour)}" required></label><label>Start time<input type="time" name="time" value="${inputTime(data.now+2*hour)}" required></label>
  <label>Duration (hours)<input type="number" name="hours" min="0.5" max="24" step="0.5" value="${f.hours??4}" required></label><label>Guards needed<input type="number" name="count" min="1" max="120" value="${f.count??1}" required></label>
  <details class="full" id="specialist-fields"><summary>Specialist staffing and priority</summary><div class="fields"><label>Supervisor posts included<input name="supervisors" type="number" min="0" value="${f.supervisors||0}" required></label><label>Special requirements<span><input type="checkbox" name="force" ${f.force?'checked':''}> Use of force / MORB</span><span><input type="checkbox" name="vehicle" ${f.vehicle?'checked':''}> Vehicle / lockbox</span></label><label>Minimum tier<select name="tier">${tiers.map((tier,i)=>option(i,tier,f.tier??0)).join('')}</select></label><label>Priority<select name="rush">${option('regular','Regular',f.rush)}${option('urgent','Urgent',f.rush)}</select></label></div></details>
  <label>Request channel<select name="source"><option>Portal</option><option>Email</option><option>Phone</option></select></label><label>Dress code<input name="dress" maxlength="160" value="${safe(f.dress||'')}"></label><label class="full">Site instructions<textarea name="notes" rows="2" maxlength="400" placeholder="Use fictional details only">${safe(f.notes)}</textarea></label></div><p id="priority-note" class="sub" aria-live="polite"></p><button class="button primary">Submit request</button>${view.template?' '+button('Clear template','clear-template'):''}</form></details>
</div>`;
}

function parseRequestDraft(msg) {
  const count=msg.match(/\b(\d+)\s*(?:extra\s+)?(?:guards?|people|guys)\b/i);
  const supervisors=msg.match(/\b(\d+)\s*supervisors?\b/i);
  const time=msg.match(/\b(?:at|by|from)\s+(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/i);
  const duration=msg.match(/\bfor\s+(\d+(?:\.\d+)?)\s*hours?\b/i);
  const relative=msg.match(/\bin\s+(\d+(?:\.\d+)?|[a-z]+)\s+hours?\b/i);
  const hourWords=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  const amount=relative?.[1].toLowerCase()||'0';
  const delay=/^\d/.test(amount)?Number(amount):hourWords.indexOf(amount);
  const relativeStart=new Date(Math.ceil((data.now+delay*hour)/minute)*minute);
  const useRelative=!time&&delay>0&&Number.isFinite(relativeStart.getTime());
  const words=new Set(msg.toLowerCase().match(/[a-z]+/g));
  const mentioned=sites.filter(site=>words.has(site.name.split(' ')[0].toLowerCase())||words.has(site.area.toLowerCase()));
  const [site]=mentioned;
  return {
    site:mentioned.length===1?site.id:'',
    count:count?.[1]||'',
    supervisors:supervisors?.[1]||0,
    hours:duration?.[1]||'',
    date:useRelative?inputDate(relativeStart):words.has('tomorrow')?inputDate(data.now+day):words.has('today')?inputDate(data.now):'',
    time:useRelative?inputTime(relativeStart):time?String(Number(time[1])%12+(time[3].toLowerCase()==='pm'?12:0)).padStart(2,'0')+':'+(time[2]||'00'):'',
    tier:0,
    force:/\b(?:use[\s-]+of[\s-]+force|morb)\b/i.test(msg),
    vehicle:/\b(?:vehicles?|lock[\s-]?box(?:es)?|mobile patrol)\b/i.test(msg),
    rush:'regular'
  };
}

function extractEmailDraft(msg,fields) {
  const draft=parseRequestDraft(msg);fields.source.value="Email";
  for(const key of ['site','count','supervisors','hours','date','time'])fields[key].value=draft[key];
  fields.force.checked=draft.force;
  fields.vehicle.checked=draft.vehicle;
  priority();
  announce(draft.site?'Draft extracted. Review before submitting.':'Choose a site for this account and review the extracted draft.');
}

document.addEventListener('click',event=>{
  const target=event.target.closest('button[data-action]');
  if(!target) return;
  const {action,id,extra}=target.dataset;
  if(action==='logout'){signOut();return;}
  if(!account)return;
  if(handleChatAction(action,id))return;
  if(action==='guard-tab'){view.guardTab=id;render();window.scrollTo(0,0);document.querySelector(`[data-action=guard-tab][data-id="${id}"]`)?.focus();return;}
  if(action==='alert-device'&&view.role==='guard'){toggleRushSound();return;}
  const r=byId(id);
  if(action==='extract'&&view.role==='client'){
    extractEmailDraft(document.querySelector('#email').value,document.querySelector('#create-request').elements);
    return;
  }
  if(action==='week'){view.weekOpen=true;view.weekOffset=(view.weekOffset||0)+Number(id);render();return;}
  if(action==='cancel'&&!confirm('Remove this assignment and reopen the post?'))return;
  if(action==='remove-window'){submitAction(action,id);return;}
  if(action==='phone-alert'){managePhoneAlerts();return;}
  if(action==='reset'){if(confirm('Reset to the original fictional scenario?')) submitAction('reset','',data.scenario);return;}
  if(action==='jump-review'){document.querySelector('#volunteer-review')?.focus();return;}
  if(action==='jump-briefs'){const details=document.querySelector('#assigned-briefs');if(details){details.open=true;details.querySelector('summary').focus();}return;}
  if(action==='back-queue'){view.mobileDetail=false;render();document.querySelector('[data-action="select"][aria-pressed="true"]')?.focus();return;}
  if(action==='select'&&r){view.mobileDetail=true;openRequest(r);render();announce('');return;}
  if(action==='page'){view.page+=Number(id);document.querySelector('#queue-results').innerHTML=queueResults();return;}
  if(action==='repeat'&&r&&view.role==='client'&&requestsForClient().includes(r)){
    view.template=r.id;
    view.prefill={dress:r.dress,supervisors:r.supervisors,force:r.force,vehicle:r.vehicle,site:r.site,tier:r.tier,hours:(r.end-r.start)/hour,count:r.need,rush:'regular',notes:r.notes};
    render();document.querySelector('#create-request input').focus();return;
  }
  if(action==='clear-template'){view.template=null;view.prefill={};render();return;}
  const actions=view.role==='admin'?adminActions:view.role==='guard'?guardActions:{};
  const special=action==='accept-change'&&extra==='swap'?byId(data.swaps.find(x=>x.id===Number(id))?.shift):r;
  if(['approve','batch','accept-change'].includes(action)&&(special?.vehicle||special?.force)&&!confirm('Have you verified the special post requirements and selected credentials?'))return;
  if(Object.hasOwn(actions,action)) submitAction(action,id,extra);
});

document.addEventListener('input',event=>{
  if(event.target.id!=='queue-search') return;
  view.search=event.target.value;
  view.page=0;
  document.querySelector('#queue-results').innerHTML=queueResults();
});

document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='scenario'){if(confirm('Replace the shared schedule with this scenario?')) submitAction('reset','',el.value);else render();return;}
  if(el.id==='status-filter'){view.status=el.value;view.page=0;document.querySelector('#queue-results').innerHTML=queueResults();return;}
  if(el.classList.contains('pick')){
    if(el.checked)view.checked.add(Number(el.value));
    else view.checked.delete(Number(el.value));
    render();
    document.querySelector(`.pick[value="${Number(el.value)}"]`)?.focus();
  }
});


document.addEventListener('submit',event=>{
  event.preventDefault();
  const form=event.target;
  if(form.id==='login'){signIn(form);return;}
  if(!account)return;
  const values=new FormData(form);
  if(form.id==='find-record'){const g=guardBy(Number(values.get('guard')));if(!g){announce('Unknown guard ID.',true);return;}view.recordGuard=g.id;view.recordOpen=true;render();return;}
  if(form.id==='review-duty'){submitAction('review-duty',form.dataset.request,form.dataset.guard,Object.fromEntries(values));return;}
  if(form.id==='call-log'){submitAction('call-note',form.dataset.request,form.dataset.guard,Object.fromEntries(values));return;}
  if(form.id==='adjust-form'){submitAction('adjust-assignment',form.dataset.request,values.get('guard'),Object.fromEntries(values));return;}
  if(form.id==='chat-form'){
    const prompt=String(values.get('prompt')).trim();
    if(prompt){form.reset();askSigma(prompt);}
    return;
  }
  if(form.id==='unavailable'){submitAction('unavailable','','',Object.fromEntries(values));return;}
  if(form.id==='preferences'){
    submitAction('preferences','','',{days:values.getAll('days'),blocks:values.getAll('blocks'),maxHours:Number(values.get('maxHours')),rush:values.has('rush')});
    return;
  }
  submitAction(form.dataset.swap?'swap-request':form.id,form.dataset.swap||'','',Object.fromEntries(values));
});

const requestApi=typeof standaloneRequest==='function'?standaloneRequest:fetch;
const roleTitles={admin:'Dispatch Admin',client:'Client Portal',guard:'Guard Account'};
const apiOptions=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
let account=null, revision=-1, busy=false, generation=0;

function showLogin() {
  account=null;
  revision=-1;
  generation++;
  data=null;
  sites=[]; clients={}; guards=[];
  view.checked.clear();
  resetChat();
  document.querySelector('#command').innerHTML='';
  document.querySelector('#account').innerHTML='';
  document.querySelector('#screen').innerHTML=`
    <section class="card login-card">
      <h1>Sign in</h1>
      <form id="login" class="login-form">
        <label for="login-name">Account ID, client company or contact name</label>
        <input id="login-name" name="login" autocomplete="username" maxlength="160" required>
        <p id="login-role" class="small" aria-live="polite"></p>
        <label for="login-password">Password or PIN</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" maxlength="256" required>
        <button class="button primary" type="submit">Sign in</button>
      </form>
    </section>`;
}
document.addEventListener('input',event=>{
  const input=event.target;
  if(input.id!=='login-name')return;
  const value=input.value.trim();
  const numbered=/^[1234]\d*$/.test(value);
  const role=numbered?({1:'admin',2:'client',3:'guard',4:'guard'})[value[0]]:value&&!/^\d+$/.test(value)?'client':null;
  input.inputMode=numbered?'numeric':'text';
  document.querySelector('#login-role').innerHTML=role?tag(roleTitles[role]):'';
});

async function signIn(form) {
  if(busy)return;
  busy=true;
  const control=form.querySelector('button');
  control.disabled=true;
  try{
    const response=await requestApi('/api/login',apiOptions(Object.fromEntries(new FormData(form))));
    if(!response.ok)throw Error((await response.json()).error);
    announce('');
  }catch(error){announce(error.message,true);}
  finally{busy=false;control.disabled=false;await refresh();}
}

async function signOut() {
  if(busy)return;
  busy=true;
  try{
    const response=await requestApi('/api/logout',apiOptions({}));
    if(!response.ok)throw Error((await response.json()).error);
    showLogin();
    announce('');
    document.querySelector('#login-name').focus();
  }catch(error){announce(error.message,true);}
  finally{busy=false;}
}

function install(record) {
  if(account?.id!==record.account.id){
    view.checked.clear();
    resetChat();
    Object.assign(view,{mobileDetail:false,selected:1,search:'',status:'all',page:0,template:null,prefill:{},guardTab:'shifts',scheduleMode:'Agenda',calendarDate:null});
  }
  account=record.account;
  Object.assign(view,{role:account.role,guard:account.guard,client:account.client});
  ({sites,clients,guards}=record.catalog);
  data=record.state;
  revision=record.revision;
  if(!byId(view.selected))view.selected=data.requests[0]?.id;
}

async function submitAction(action,id='',extra='',fields={}) {
  if(busy||!account)return false;
  busy=true;
  let completed=false;
  try{
    const response=await requestApi('/api/actions',apiOptions({revision,account:account.id,checked:[...view.checked],action,id,extra,fields}));
    const result=await response.json();
    if(response.status===401)showLogin();
    if(!response.ok)throw Error(result.error);
    install(result);
    if(action==='adjust-assignment'||action==='create-request'||action==='reset')view.selected=result.selected;
    if(action==='create-request'){view.template=null;view.prefill={};}
    view.checked=new Set(result.checked);
    render();
    announce(result.message);
    completed=true;
  }catch(error){announce(error.message,true);}
  finally{busy=false;refresh();}
  return completed;
}

async function refresh() {
  if(busy)return;
  const before=generation;
  try{
    const reply=await requestApi('/api/state?since='+revision+'&account='+(account?.id||''),{cache:'no-store'});
    if(busy||generation!==before||reply.status===204)return;
    if(reply.status===401){if(account||!document.querySelector('#login'))showLogin();return;}
    if(!reply.ok)throw Error('Schedule unavailable.');
    const record=await reply.json();
    if(busy||generation!==before||record.account.id===account?.id&&record.revision<=revision)return;
    const selector='#screen form input,#screen form textarea,#screen form select,#email';
    const drafts=record.account.id===account?.id?[...document.querySelectorAll(selector)].map(el=>({
      id:el.id,name:el.name,form:el.form?.id||el.form?.dataset.swap,kind:el.type,value:el.value,checked:el.checked,
      focused:el===document.activeElement,start:el.selectionStart,end:el.selectionEnd
    })):[];
    const openDetails=[...document.querySelectorAll('#screen details[open]')].map(el=>el.id).filter(Boolean);
    const emailOpen=document.querySelector('#email')?.closest('details').open;
    install(record);
    render();
    const fields=[...document.querySelectorAll(selector)];
    for(const draft of drafts){
      const el=fields.find(input=>draft.id?input.id===draft.id:(input.form?.id||input.form?.dataset.swap)===draft.form&&input.name===draft.name&&(draft.kind!=='checkbox'||input.value===draft.value));
      if(!el)continue;
      if(el.type==='checkbox')el.checked=draft.checked;
      else el.value=draft.value;
      if(draft.focused){
        el.focus({preventScroll:true});
        if(draft.start!==null&&typeof el.setSelectionRange==='function')el.setSelectionRange(draft.start,draft.end);
      }
    }
    for(const id of openDetails){const details=document.getElementById(id);if(details)details.open=true;}
    if(emailOpen&&drafts.length)document.querySelector('#email')?.closest('details').setAttribute('open','');
    if(view.role==='client')priority();
  }catch{
    if(!account&&!document.querySelector('#login'))showLogin();
    announce(typeof standaloneRequest==='function'?'Browser storage is unavailable. Check your browser settings and reopen this file.':'Connection interrupted. Reconnecting to Sigma Dispatch…',true);
  }
}

function startApp() {
  showLogin();
  refresh();
  setInterval(refresh,1500);
  setInterval(()=>{
    if(!data)return;
    const oldTime=data.now;
    data.now=Date.now();
    if(view.role==='admin'){
      const crossed=t=>t>oldTime&&t<=data.now;
      const due=data.requests.some(r=>crossed(r.start)||crossed(r.followUp?.due)||Object.values(r.offers).some(o=>crossed(Math.min(o.expires,o.replyDeadline||Infinity))));
      const request=byId(view.selected);
      if(request&&(due||Math.floor((request.start-oldTime)/minute)!==Math.floor((request.start-data.now)/minute))){
        const decision=document.querySelector('#decision');
        const opened=[...decision.querySelectorAll('details[open]')].map(el=>el.id);
        const focused=document.activeElement;
        const selector=decision.contains(focused)&&focused.dataset.action?'button[data-action="'+focused.dataset.action+'"][data-extra="'+focused.dataset.extra+'"]':null;
        const drafts=[...decision.querySelectorAll('form[id] input,form[id] select')].map(el=>({form:el.form.id,name:el.name,value:el.value,focused:el===focused}));
        decision.innerHTML=requestPanel(request);
        for(const draft of drafts){
          const el=document.getElementById(draft.form)?.elements.namedItem(draft.name);
          if(el){el.value=draft.value;if(draft.focused)el.focus({preventScroll:true});}
        }
        for(const id of opened){const el=document.getElementById(id);if(el)el.open=true;}
        if(selector)decision.querySelector(selector)?.focus({preventScroll:true});
        document.querySelector('#queue-results').innerHTML=queueResults();
        const active=data.requests.filter(r=>!isPast(r));
        const metrics=document.querySelectorAll('.metric strong');
        metrics[0].textContent=active.reduce((sum,r)=>sum+open(r),0);
        metrics[1].textContent=active.filter(r=>r.rush&&open(r)).length;
        metrics[2].textContent=active.reduce((sum,r)=>sum+waiting(r),0)+[...data.leaves,...data.swaps].filter(x=>x.status==='Pending').length;
      }
    }
    const clock=document.querySelector('.clock');
    if(clock)clock.textContent=formatTime(data.now);
    updateRushCountdown();
  },1000);
  if('serviceWorker' in navigator&&location.protocol!=='file:')navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
document.addEventListener('DOMContentLoaded',startApp);
function weekBoard(){
  const today=inputDate(data.now);
  const monday=calendarDate(today,1-(new Date(today+'T12:00Z').getUTCDay()||7)+(view.weekOffset||0)*7);
  const dates=Array.from({length:7},(_,i)=>calendarDate(monday,i));
  const rows=sites.map(site=>{
    const shifts=data.requests.filter(r=>r.need&&r.site===site.id&&inputDate(r.start)<=dates[6]&&inputDate(r.end-1)>=monday);
    if(!shifts.length)return '';
    return '<tr><th>'+safe(site.name)+'</th>'+dates.map(d=>'<td>'+shifts.filter(r=>inputDate(r.start)<=d&&inputDate(r.end-1)>=d).map(r=>button(formatTime(r.start)+' · '+coverage(r),'select',r.id)).join(' ')+'</td>').join('')+'</tr>';
  }).join('');
  return `<details class="card" id="week-board" ${view.weekOpen?'open':''}><summary>Week by site</summary><div class="row">${button('Previous week','week',-1)}<strong>${monday} – ${dates[6]}</strong>${button('Next week','week',1)}</div><div style="overflow:auto"><table><thead><tr><th>Site</th>${dates.map(d=>'<th>'+d.slice(5)+'</th>').join('')}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
}
function operationsTools(r){
  const id=view.recordGuard||r.cancelledGuard||r.assignments[0]?.guard||Number(Object.keys(r.offers)[0])||guards.find(g=>!g.available)?.id;
  const g=guardBy(id);
  const reviews=data.requests.flatMap(x=>x.assignments.filter(a=>a.guard===g.id&&a.review).map(a=>a.review));
  const cancellations=data.requests.flatMap(x=>(x.history||[]).filter(e=>e.guard===g.id&&e.status==='Guard cancelled')).length;
  return `<details class="details" id="guard-record" ${view.recordOpen?'open':''}><summary>Guard record and phone follow-up</summary>
    <form id="find-record" class="wrap"><label>Guard ID <input name="guard" type="number" min="3001" max="4000" required value="${g.id}"></label><button class="button">Find guard</button></form>
    <strong>${safe(g.name)} · ${g.id}</strong><p>${g.available?'Available on roster':'Marked unavailable'} · ${g.onTime+reviews.filter(v=>v.arrival==='On time').length}/${g.completed+reviews.length} shifts on time · ${g.priorCancellations} prior cancellations + ${cancellations} logged here.</p>
    <p>Report quality: ${g.reportRecord.accepted+reviews.filter(v=>v.report==='Accepted').length}/${g.reportRecord.reviewed+reviews.length} reports accepted. ${safe(g.reportRecord.basis)} · ${inputDate(Math.max(g.reportRecord.asOf,...reviews.map(v=>v.at)))}.</p>
      ${r.end<=data.now&&r.assignments.some(a=>a.guard===g.id)?`<form id="review-duty" data-request="${r.id}" data-guard="${g.id}" class="wrap"><label>Arrival<select name="arrival"><option>On time</option><option>Late</option></select></label><label>Report<select name="report"><option>Accepted</option><option>Needs correction</option></select></label><label>Review basis<input name="note" maxlength="200" required></label><button class="button">Save duty review</button></form>`:''}
    <p>Fictional duty phone: <a href="tel:${g.phone.split(' ext ')[0]};ext=${g.id}">${safe(g.phone)}</a></p><form id="call-log" data-request="${r.id}" data-guard="${g.id}" class="wrap"><label>Call outcome <select name="outcome"><option>No answer</option><option>Unavailable</option><option>Will review offer</option></select></label><button class="button">Record follow-up</button></form></details>
    <details class="details" id="shift-history"><summary>Shift history</summary>${(r.history||[]).slice().reverse().map(e=>`<p>${formatDay(e.at)} · ${formatTime(e.at)} · ${safe(e.status)} ${e.guard?'· '+e.guard:''}</p>`).join('')||'No recorded changes.'}</details>
    ${r.assignments.length&&!isPast(r)?`<details id="adjust-post"><summary>Adjust an assigned shift</summary><form id="adjust-form" data-request="${r.id}" class="wrap"><label>Assigned guard<select name="guard">${r.assignments.map(a=>option(a.guard,guardBy(a.guard).name+' · '+a.guard)).join('')}</select></label><label>Date<input name="date" type="date" value="${inputDate(r.start)}" required></label><label>Start<input name="time" type="time" value="${inputTime(r.start)}" required></label><label>Hours<input name="hours" type="number" min=".5" max="24" step=".5" value="${(r.end-r.start)/hour}" required></label><button class="button">Reoffer revised post</button></form></details>`:''}`;
}
