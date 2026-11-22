'use strict';
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,name),'utf8');
const script=`
const offlineBundle=(()=>{
  const sources={};
  const load=(name,source)=>{
    const module={exports:{}};
    source(module,key=>sources[key]);
    sources[name]=module.exports;
  };
  load('./catalog.js',(module,require)=>{ ${read('catalog.js')} });
  load('./model.js',(module,require)=>{ ${read('model.js')} });
  load('./accounts.js',(module,require)=>{ ${read('accounts.js')} });
  return {engine:sources['./model.js'],accounts:sources['./accounts.js']};
})();
${['offline.js','model.js','app.js','guard.js','chat.js'].map(read).join('\n')}
`;
new (require('node:vm').Script)(script);
const html=read('index.html')
  .replace(/  <link rel="(?:manifest|apple-touch-icon)"[^>]+>\r?\n/g,'')
  .replace(/  <script src="\/model\.js"><\/script>.*<\/script>/,()=>'<script>'+script.replaceAll('</script','<\\/script')+'</script>');
fs.writeFileSync(path.join(__dirname,'Open Sigma Dispatch.html'),html);
