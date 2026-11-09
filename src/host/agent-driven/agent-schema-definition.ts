import type { DatabaseSync } from 'node:sqlite';

/** Lex fixed SQL without erasing literal contents; whitespace/comments are not semantics. */
function tokens(sql:string):string[]{
 const out:string[]=[];let i=0;
 while(i<sql.length){
  const c=sql[i]!;
  if(/\s/.test(c)){i++;continue;}
  if(sql.startsWith('--',i)){const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end+1;continue;}
  if(sql.startsWith('/*',i)){const end=sql.indexOf('*/',i+2);if(end<0)throw new Error('Invalid frozen SQL');i=end+2;continue;}
  if(c==="'"||c==='"'||c==='`'||c==='['){
   const endChar=c==='['?']':c,start=i++;let closed=false;
   while(i<sql.length){if(sql[i]===endChar){if(sql[i+1]===endChar){i+=2;continue;}i++;closed=true;break;}i++;}
   if(!closed)throw new Error('Invalid frozen SQL');out.push(sql.slice(start,i));continue;
  }
  if(/[A-Za-z0-9_$]/.test(c)){const start=i++;while(i<sql.length&&/[A-Za-z0-9_$]/.test(sql[i]!))i++;out.push(sql.slice(start,i));continue;}
  out.push(c);i++;
 }
 return out;
}
function normalize(input:readonly string[]):string[]{
 const value=[...input];
 const kind=value[1]?.toUpperCase()==='UNIQUE'?2:1;
 if(value[kind+1]?.toUpperCase()==='IF'&&value[kind+2]?.toUpperCase()==='NOT'&&value[kind+3]?.toUpperCase()==='EXISTS')value.splice(kind+1,3);
 if(value.at(-1)===';')value.pop();
 return value;
}
interface Definition {type:string;name:string;tbl_name:string;sql:string[];}
function frozenDefinitions(sql:string):Definition[]{
 const all=tokens(sql),out:Definition[]=[];
 for(let i=0;i<all.length;i++){
  if(all[i]?.toUpperCase()!=='CREATE')continue;
  const kindIndex=all[i+1]?.toUpperCase()==='UNIQUE'?i+2:i+1;
  const kind=all[kindIndex]?.toLowerCase();
  if(kind!=='table'&&kind!=='index'&&kind!=='trigger')throw new Error('Unsupported frozen schema');
  const nameIndex=all[kindIndex+1]?.toUpperCase()==='IF'?kindIndex+4:kindIndex+1;
  const name=all[nameIndex];if(!name||!/^[a-z][a-z0-9_]*$/.test(name))throw new Error('Unsupported frozen schema name');
  let depth=0,end=i;
  for(;end<all.length;end++){
   if(kind==='trigger'){
    if(all[end]?.toUpperCase()==='BEGIN')depth++;
    if(all[end]?.toUpperCase()==='END')depth--;
   }
   if(all[end]===';'&&depth===0)break;
  }
  if(end===all.length)throw new Error('Incomplete frozen schema');
  const statement=all.slice(i,end+1),on=statement.findIndex(t=>t.toUpperCase()==='ON');
  const table=kind==='table'?name:statement[on+1];if(!table)throw new Error('Unsupported frozen schema target');
  out.push({type:kind,name,tbl_name:table,sql:normalize(statement)});i=end;
 }
 return out;
}
const sort=(a:Definition,b:Definition)=>a.type===b.type?(a.name<b.name?-1:a.name>b.name?1:0):a.type<b.type?-1:1;
/** Compare against the immutable shipped DDL, not a database's own self-reported receipt. */
export function matchesFrozenAgentSchema(db:DatabaseSync,migration:string,receiptDDL:string):boolean {
 const expected=frozenDefinitions(migration+'\n'+receiptDDL+';').sort(sort);
 const actual=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name GLOB 'cp_a0_*' OR name='agent_driven_schema_receipt' ORDER BY type,name").all().map(row=>({type:String(row.type),name:String(row.name),tbl_name:String(row.tbl_name),sql:normalize(tokens(String(row.sql)))}));
 return JSON.stringify(actual)===JSON.stringify(expected);
}
