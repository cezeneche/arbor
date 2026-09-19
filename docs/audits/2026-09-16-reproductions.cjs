const fs=require('fs'),path=require('path'),vm=require('vm');
const root=process.cwd(),ts=require(path.join(root,'node_modules/typescript'));
function load(file,mocks={}){
 const src=fs.readFileSync(path.join(root,file),'utf8');
 const code=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 const customRequire=(s)=>{if(s in mocks)return mocks[s];if(s.startsWith('@/'))return load('src/'+s.slice(2)+'.ts',mocks);if(s.startsWith('.'))return load(path.relative(root,path.resolve(root,path.dirname(file),s))+'.ts',mocks);return require(require.resolve(s,{paths:[root]}));};
 vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{console,process,URL,Request,Response,AbortController,setTimeout,clearTimeout,Buffer})(customRequire,module,module.exports);
 return module.exports;
}
(async()=>{
 const publicPaths=load('src/lib/public-paths.ts');
 console.log('supplier page public:',publicPaths.isPublicPath('/supplier/test-token'));
 console.log('supplier submission public:',publicPaths.isPublicPath('/api/supplier-form/test-token'));
 const next={NextResponse:{json:(data,opts)=>({status:opts?.status??200,data})}};
 const session={user:{id:'user-A',entityId:'entity-A',role:'CONTRIBUTOR'}};
 let requested;
 const route=load('src/app/api/cbam/cases/[caseId]/route.ts',{'next/server':next,'@/lib/page-auth':{requirePageSession:async()=>session},'@/lib/nucleos/cases-client':{getCbamCase:async(id)=>{requested=id;return {id,owner:'entity-B',importer_name:'Private B'};}}});
 console.log('A reads B case via actual route with mocked downstream:',JSON.stringify(await route.GET(new Request('http://audit.local'),{params:Promise.resolve({caseId:'case-B'})})));
 const context=load('src/lib/nucleos/case-calculation.ts',{'@/lib/prisma':{prisma:{cbamCaseLink:{findFirst:async()=>null}}},'./cases-client':{},'./declaration-payload':{},'./calculate-client':{},'./emissions-presenter':{},'./jurisdiction':{}});
 console.log('Unlinked case ownership decision:',JSON.stringify(await context.caseContext('legacy-B','entity-A')));
 const writer=load('src/lib/layer2/cbam-handoff.ts',{'@/lib/prisma':{prisma:{}},'@/lib/nucleos/case-payload':{buildCasePayload:()=>({payload:{},problems:[]})},'@/lib/nucleos/case-writer':{},'@/lib/nucleos/cbam-relevance':{isCbamRelevant:()=>true}});
 let created=0;const ids=[];
 const db={cbamCaseLink:{findUnique:async()=>null,upsert:async({create})=>{ids.push(create.nucleosCaseId);return create}}};
 const createCase=async()=>({caseId:'case-'+(++created),goodsLineIds:['line'],problems:[]});
 const input={documentId:'same-doc',entityId:'A',documentType:'CUSTOMS_DECLARATION',jurisdiction:'EU',confirmed:new Map(),reportingPeriodEnd:new Date()};
 await Promise.all([writer.handOffCbamCase(input,{db,createCase}),writer.handOffCbamCase(input,{db,createCase})]);
 console.log('Concurrent handoff external creations before link upsert:',created,ids);
})().catch(e=>{console.error(e);process.exitCode=1});
const admission=load('src/lib/extraction/admissibility.ts');
const fieldsModule=load('src/lib/extraction/field-definitions.ts');
const finalTier=load('src/lib/layer2/confirm-validation.ts');
const values={account_holder_name:'Acme Ltd',site_address:'1 Industrial Way',meter_reference:'S1234567890',period_start:'2024-01-01',period_end:'2024-03-31',total_consumption_kwh:'150000',read_type:'ESTIMATED',supplier_name:'British Gas',invoice_number:'INV-001',invoice_date:'2024-04-01'};
const fields=Object.entries(values).map(([fieldName,rawValue])=>({fieldName,rawValue,rawUnit:null,sourceText:'source',confidenceScore:.99,flagged:false,flagReason:null}));
const comp=new Set(fieldsModule.DOCUMENT_FIELD_DEFINITIONS.ELECTRICITY_BILL.filter(f=>f.admissibility==='compulsory').map(f=>f.name));
console.log('Estimated electricity: extraction tier',admission.evaluateAdmissibility('ELECTRICITY_BILL',fields,'Acme Ltd').tier,'confirmation tier',finalTier.deriveTrustTier({extracted:new Map(Object.entries(values)),confirmed:new Map([['total_consumption_kwh','150000']]),compulsory:comp,hasExtraction:true}));
console.log('OTHER document: extraction tier',admission.evaluateAdmissibility('OTHER',[fields[0]],'Acme Ltd').tier,'confirmation tier',finalTier.deriveTrustTier({extracted:new Map(),confirmed:new Map([['rent','100']]),compulsory:new Set(),hasExtraction:true}));
(async()=>{
 let captured;
 const route=load('src/app/api/records/manual/route.ts',{'@/lib/session':{getSessionUser:s=>s.user},'@/lib/auth-helpers':{requireWriteAccess:async()=>({session:{user:{id:'u',entityId:'A'}}})},'@/lib/layer2/record-writer':{writeRecordWithAuditEntry:async(tx,input)=>{captured=input;return {recordId:'mock'}}},'@/lib/layer2/serializable':{runSerializable:async(f)=>f({})},'@/lib/plan-guard':{assertRecordCapacity:async()=>({allowed:true})}});
 const res=await route.POST(new Request('http://audit.local',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({domain:'ENERGY',fieldName:'total_consumption_kwh',value:100,unit:'kwh',periodStart:'2026-01-01T00:00:00.000Z',periodEnd:'2026-04-01T00:00:00.000Z'})}));
 console.log('Manual record status',res.status,'writer received',captured.value,captured.unit,'expected canonical',load('src/lib/layer3/unit-conversion.ts').normaliseToSI(100,'kwh'));
})().catch(e=>{console.error(e);process.exitCode=1});
