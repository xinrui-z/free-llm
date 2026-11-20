// Fake checker API for the dynamic e2e suite. Port: CATALOG_TEST_PORT (default 4334).
import { createServer } from 'node:http';
import { readFileSync,readdirSync } from 'node:fs';
import { providerFields,modelFields } from './public-catalog-fields.mjs';
const port=Number(process.env.CATALOG_TEST_PORT||4334);
const dir=new URL('../src/data/providers/',import.meta.url);
const providers=readdirSync(dir).filter(f=>f.endsWith('.json')&&!f.startsWith('_')).map(f=>JSON.parse(readFileSync(new URL(f,dir),'utf8')));
const extra={id:'discovered-demo',name:'Discovered Demo',description:'A newly reviewed provider',base_url:'https://demo.example.com/v1',status:'active',auth:'required',last_verified:'2026-11-17',
  sources:[{url:'https://demo.example.com/docs',label:'Demo docs',checked_at:'2026-11-17'}],top_models:['fresh-model'],models:[
  {id:'fresh-model',name:'Fresh Model',status:'active',modalities:['text']},
  {id:'unobserved-model',name:'Unobserved Model',status:'active',modalities:['text']},
]};
// Serves the checker's public catalog DTO shape (field whitelist in ./public-catalog-fields.mjs).
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const replicaCatalog=snapshot=>({...pick(snapshot,['revision','updated_at']),providers:snapshot.providers.map(p=>({
  ...pick(p,providerFields),models:p.models.map(m=>pick(m,modelFields)),
  ...(p.paid_models?{paid_models:p.paid_models.map(m=>pick(m,modelFields))}:{}),
}))});
const publicCatalog=replicaCatalog;
let state={extra:false,mode:'live'};
// How the last /api/catalog request arrived: 'checker-binding' via tests/fake-checker/worker.mjs, else 'http'.
let lastVia='';
createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/test/state'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    state={extra:false,mode:'live',...JSON.parse(body)};res.end('{}');return;
  }
  if(req.url==='/test/last-via'){res.end(JSON.stringify({via:lastVia}));return;}
  if(req.url==='/api/catalog'){
    lastVia=req.headers['x-test-via']||'http';
    if(state.mode==='offline'){res.statusCode=503;res.end('{}');return;}
    if(state.mode==='malformed'){res.end('{"providers":[null]}');return;}
    const revision=state.extra?'revision-two':'revision-one';
    res.end(JSON.stringify(publicCatalog({revision,updated_at:'2026-11-17T00:00:00.000Z',providers:[...providers,...(state.extra?[extra]:[])]})));return;
  }
  res.statusCode=404;res.end('{}');
}).listen(port,'127.0.0.1');
