const {guards,clients}=require('./catalog.js');

const demoAccounts=[
  {id:1001,role:'admin',name:'Jordan Ellis'},
  {id:1002,role:'admin',name:'Casey Morgan'},
  {id:2001,role:'client',name:'Vivian Chen',client:'c1',company:clients.c1},
  {id:2002,role:'client',name:'Rowan Ellis',client:'c2',company:clients.c2},
  {id:1003,role:'admin',name:'Avery Brooks'},
  ...Object.entries(clients).slice(2).map(([client,company])=>{
    const number=Number(client.slice(1));
    return {id:2000+number,role:'client',name:'Site coordinator '+number,client,company};
  }),
  ...guards.map(({id,name})=>({id,role:'guard',name,guard:id}))
];
const demoPassword=({role,id})=>`${{admin:'Admin',client:'Client',guard:'Guard'}[role]}-${id}-demo`;
const loginKey=value=>String(value??'').trim().replace(/\s+/g,' ').toLowerCase();

module.exports={demoAccounts,demoPassword,loginKey};
