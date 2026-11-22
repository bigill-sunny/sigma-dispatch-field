const attendanceLink=()=>location.hash.match(/^#attendance=(\d+)\.([\w-]{32})$/);
let qrReaderLoading;

function attendanceScanPanel(){
  if(!data.qrAttendance)return '';
  const pending=attendanceLink();
  if(!pending)return '';
  return `<section class="card"><h2>Supervisor QR scanned</h2>${data.attendanceLocation?'<p>Share your current location to verify attendance.</p>':''}${button(data.attendanceLocation?'Verify location and check in':'Check in','redeem-attendance',Number(pending[1]),'','primary')}</section>`;
}

function attendancePinPanel(r){
  if(!data.qrAttendance||!data.attendanceLocation)return '';
  return `<details class="details" id="attendance-pin"><summary>Attendance site pin · ${data.attendanceSites?.includes(r.site)?'Configured':'Required for QR check-in'}</summary>
    <p class="sub">Use the designated on-site meeting point. Updating the pin invalidates current QR codes for this site.</p>
    <form id="save-attendance-pin" data-site="${r.site}" class="fields"><label>Latitude<input name="latitude" inputmode="decimal" type="number" step="any" min="-90" max="90" required></label>
    <label>Longitude<input name="longitude" inputmode="decimal" type="number" step="any" min="-180" max="180" required></label>
    <button class="button">Save site pin</button>${button('Use my current location','fill-attendance-pin')}</form></details>`;
}

function supervisorCrewPanel(){
  const roster=data.requests.filter(r=>r.supervisory);
  return roster.map(r=>`<details class="card" id="crew-${r.id}"><summary>Supervisor crew · ${safe(r.location.name)}</summary>
    <p>${shiftTime(r)}</p>${data.qrAttendance&&attendanceWindow(r,data.now)?button('Show attendance QR','issue-attendance',r.id,'','primary'):''}
    ${r.crew.length?r.crew.map(member=>`<form class="attendance-fit" id="review-${r.id}-${member.id}" data-booking-action="supervisor-review" data-request="${r.id}">
      <input name="guard" type="hidden" value="${member.id}"><strong>${safe(member.name)} · ${tiers[member.tier]}</strong>
      <p class="sub">${member.post?'Assigned · '+member.post:'Volunteer · awaiting dispatch'}${member.checkedIn?' · '+(['qr','qr-location'].includes(member.checkedIn)?'QR attendance verified':'Arrival recorded'):''}</p>
      <div class="fields"><label>Fit assessment<select name="verdict">${['Good fit','Needs coaching','Needs review'].map(v=>option(v,v,member.review?.verdict)).join('')}</select></label>
      <label>Observed skill<select name="signal">${fitSignals.map(v=>option(v,v,member.review?.signal)).join('')}</select></label>
      <label class="full">Observation<textarea name="note" required maxlength="300">${safe(member.review?.note||'')}</textarea></label></div>
      <button class="button">${member.review?'Update fit review':'Save fit review'}</button></form>`).join(''):empty('Assigned crew and volunteers will appear here.')}</details>`).join('');
}

function currentPosition(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(Error('Location access is unavailable.'));
    navigator.geolocation.getCurrentPosition(position=>resolve({
      latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,capturedAt:position.timestamp
    }),error=>reject(Error(error.code===1?'Allow location access and try again.':'Could not get a current location fix.')),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  });
}
async function attendancePost(route,body){
  const response=await requestApi('/api/attendance/'+route,apiOptions(body));
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Attendance action failed.');
  return result;
}
function attendanceDialog(title){
  const dialog=document.createElement('dialog');
  dialog.className='attendance-dialog';
  dialog.innerHTML=`<h2>${safe(title)}</h2><div data-attendance-content></div><button type="button" class="button" data-close-attendance>Close</button>`;
  dialog.querySelector('[data-close-attendance]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
async function showAttendanceQr(requestId){
  const location=data.attendanceLocation?await currentPosition():{};
  const result=await attendancePost('issue',{requestId,...location});
  const dialog=attendanceDialog('Crew attendance QR');
  const content=dialog.querySelector('[data-attendance-content]');
  const image=document.createElement('img');
  image.src=result.image;
  image.alt='Scan this QR to check in to the shift';
  const line=document.createElement('p');
  content.append(image,line);
  const update=()=>{
    const seconds=Math.max(0,Math.ceil((result.expires-Date.now())/1000));
    line.textContent=seconds?'Code expires in '+seconds+' seconds.':'Code expired. Close and issue a new code.';
    if(!seconds)image.hidden=true;
  };
  update();
  const timer=setInterval(update,1000);
  dialog.addEventListener('close',()=>clearInterval(timer),{once:true});
}
function loadQrReader(){
  qrReaderLoading ||= new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='/qr-reader.js';
    script.onload=resolve;
    script.onerror=()=>{qrReaderLoading=null;script.remove();reject(Error('Could not load the QR reader. Use the phone Camera app to scan and open the link.'));};
    document.head.append(script);
  });
  return qrReaderLoading;
}
async function scanAttendanceQr(){
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access requires HTTPS. You can also use your phone Camera app to open the QR link.');
  await loadQrReader();
  const dialog=attendanceDialog('Scan your supervisor’s QR');
  const content=dialog.querySelector('[data-attendance-content]');
  const line=document.createElement('p');
  line.textContent='Point your camera at the supervisor’s current code.';
  const video=document.createElement('video');
  video.playsInline=true;
  video.muted=true;
  content.append(video,line);
  let stream,timer;
  dialog.addEventListener('close',()=>{clearInterval(timer);stream?.getTracks().forEach(track=>track.stop());},{once:true});
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    if(!dialog.open){stream.getTracks().forEach(track=>track.stop());return;}
    video.srcObject=stream;
    await video.play();
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    timer=setInterval(()=>{
      if(!video.videoWidth)return;
      canvas.width=Math.min(640,video.videoWidth);
      canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const result=window.jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'});
      if(!result)return;
      let link;
      try{link=new URL(result.data);}catch{return;}
      if(link.origin!==location.origin||!/^#attendance=\d+\.[\w-]{32}$/.test(link.hash)){
        line.textContent='This code is not a Sigma Dispatch attendance code.';return;
      }
      dialog.close();
      history.replaceState(null,'',link.hash);
      render();
    },180);
  }catch(error){if(dialog.open)dialog.close();throw error;}
}
async function redeemAttendance(){
  const match=attendanceLink();
  if(!match)throw Error('Scan the supervisor’s current QR code.');
  const location=data.attendanceLocation?await currentPosition():{};
  const result=await attendancePost('redeem',{requestId:Number(match[1]),code:match[2],...location});
  history.replaceState(null,'',location.pathname+location.search);
  await refresh();
  render();
  announce(result.message);
}

document.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');
  if(!account||!button)return;
  const {action,id}=button.dataset;
  const actions={
    'issue-attendance':()=>showAttendanceQr(Number(id)),
    'open-attendance-scan':scanAttendanceQr,
    'redeem-attendance':redeemAttendance,
    'fill-attendance-pin':async()=>{
      const position=await currentPosition();
      const form=document.querySelector('#save-attendance-pin');
      if(form){form.elements.latitude.value=position.latitude;form.elements.longitude.value=position.longitude;}
    }
  };
  if(actions[action])actions[action]().catch(error=>announce(error.message,true));
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if(form.id!=='save-attendance-pin')return;
  event.preventDefault();
  attendancePost('pin',{site:form.dataset.site,latitude:Number(form.elements.latitude.value),longitude:Number(form.elements.longitude.value)})
    .then(async result=>{await refresh();announce(result.message);}).catch(error=>announce(error.message,true));
},true);
window.addEventListener('hashchange',()=>{if(account?.role==='guard')render();});

function dispatchFitReviews(r){
  if(!r.fitReviews?.length)return '';
  return `<details class="details"><summary>Supervisor fit reviews · ${r.fitReviews.length}</summary>
    ${r.fitReviews.map(entry=>`<div class="entry"><strong>${safe(guardBy(entry.guard).name)} · ${safe(entry.verdict)}</strong>
      <p>${safe(entry.signal)} · ${safe(entry.note)}</p><p class="sub">Reviewed by ${safe(guardBy(entry.reviewer).name)} · ${formatDay(entry.at)} ${formatTime(entry.at)}</p></div>`).join('')}</details>`;
}
