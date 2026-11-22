const standaloneRequest=(()=>{
  const {demoAccounts,demoPassword,loginKey}=offlineBundle.accounts;
  const {seed,project,execute,canApplyCommand}=offlineBundle.engine;
  const sessionKey='sigma-offline-account';
  let accountId=null, connection;
  try{accountId=Number(sessionStorage.getItem(sessionKey));}catch{}
  function setAccount(id) {
    accountId=id;
    try{
      if(id)sessionStorage.setItem(sessionKey,String(id));
      else sessionStorage.removeItem(sessionKey);
    }catch{}
  }
  function connect() {
    connection ||= new Promise((resolve,reject)=>{
      const request=indexedDB.open('sigma-dispatch-operations',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('schedule').put({state:seed('rush'),revision:0},'board');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    }).catch(error=>{connection=null;throw error;});
    return connection;
  }
  const response=(status,body)=>({ok:status<400,status,json:async()=>body});
  return async function request(url,options={}) {
    const path=new URL(url,'http://offline.local');
    const command=options.body?JSON.parse(options.body):{};
    if(path.pathname==='/api/login'){
      const key=loginKey(command.login);
      const user=demoAccounts.find(a=>[a.id,...(a.company?[a.company,a.name]:[])].some(value=>loginKey(value)===key));
      if(!user||demoPassword(user)!==command.password)return response(401,{error:'Check your account and password.'});
      setAccount(user.id);
      return response(200,{account:user});
    }
    if(path.pathname==='/api/logout'){setAccount(null);return response(204);}
    const user=demoAccounts.find(a=>a.id===accountId);
    if(!user)return response(401,{error:'Sign in to continue.'});
    const db=await connect();
    const write=path.pathname==='/api/actions';
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction('schedule',write?'readwrite':'readonly');
      const table=transaction.objectStore('schedule');
      let reply;
      table.get('board').onsuccess=event=>{
        const board=event.target.result;
        try{
          if(write){
            if(command.account!==user.id||!canApplyCommand(board.state,command,board.revision)){
              reply=response(409,{error:'The schedule changed. Review the updated board and try again.'});
              return;
            }
            const result=execute(board.state,command,user);
            const revision=board.revision+1;
            table.put({state:result.state,revision},'board');
            reply=response(200,{...result,...project(result.state,user),account:user,revision});
          }else if(path.searchParams.get('since')===String(board.revision)&&path.searchParams.get('account')===String(user.id)){
            reply=response(204);
          }else{
            reply=response(200,{...project(board.state,user),account:user,revision:board.revision});
          }
        }catch(error){reply=response(400,{error:error.message});}
      };
      transaction.oncomplete=()=>resolve(reply);
      transaction.onabort=()=>reject(transaction.error||Error('Browser storage save failed.'));
    });
  };
})();
