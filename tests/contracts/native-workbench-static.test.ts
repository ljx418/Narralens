import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import inputHashes from '../../src/contracts/native-workbench-validator-inputs.json' with {type:'json'};
import created from '../../contracts/created-workbench.schema.json' with {type:'json'};
import legacy from '../../contracts/workbench.schema.json' with {type:'json'};
import lock from '../../contracts/public-lock.schema.json' with {type:'json'};
import {validateNativeWorkbench} from '../../src/contracts/created-workbench.js';
const minimal={format:'narralens.created-workbench@1.0',origin:'created',project_id:'project_contract',source_project_id:null,migration_id:null,revision:1,control_revision:0,source_digest:'a'.repeat(64),active_snapshot_id:'b'.repeat(64),fps:{num:30,den:1},frame_count:0,engine:'openfilm',engine_upstream_sha:'c'.repeat(40),tracks:[],clips:[],history:[],active_locks:[],capabilities:[],preview:null,narration:'absent',native_sync:'unknown'};
it('binds static browser validators to the actual unchanged schemas without dynamic compilation',()=>{
 for(const [path,hash] of Object.entries(inputHashes))expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
 expect(readFileSync('src/contracts/native-workbench-validators.mjs','utf8')).not.toMatch(/\bnew\s+Function\s*\(|\brequire\s*\(|\beval\s*\(/);
});
it('keeps compiled browser validation equivalent to the frozen created and legacy read contracts, including unknown fields and date formats',()=>{
 const ajv=new Ajv2020({allErrors:true,strict:true});addFormats(ajv);ajv.addSchema(lock);const validators=[ajv.compile(created),ajv.compile(legacy)];
 const old:Record<string,unknown>={...minimal,format:'narralens.workbench@1.0',frame_count:1,source_project_id:'legacy_source',migration_id:'migration',preview:{kind:'openfilm-studio',url:'http://127.0.0.1:1',bridge_version:1}};delete old.origin;delete old.native_sync;
 const cases:unknown[]=[minimal,old];
 for(const patch of [{frame_count:-1},{origin:'migrated'},{native_sync:'loaded'},{arbitrary_path:'/tmp/private'},{fps:{num:0,den:1}},{source_digest:'invalid'},{revision:-1},{engine:'hypit'},{active_locks:[{format:'narralens.public-lock@1.0',lock_id:'lock',project_id:'project_contract',lock_type:'visual',scope:'project',target_id:null,start_frame:0,end_frame_exclusive:1,owner_label:'本机操作者',reason_code:'preserve_visual',control_revision:1,created_at:'not-a-date'}]}])cases.push({...minimal,...patch},{...old,...patch});
 for(const value of cases){const expected=validators.some(v=>v(value));let actual=true;try{validateNativeWorkbench(value);}catch{actual=false;}expect(actual).toBe(expected);}
});
