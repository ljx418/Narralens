import {useCallback,useEffect,useRef,useState} from 'react';
import type {OwnedProjectsPage} from '../contracts/owned-projects.js';
import {readOwnedProjects,openOwnedProject} from './owned-project-client.js';
import {OwnedProjectEntry} from './observation/OwnedProjectEntry.js';
/** Root navigation only. Editing, player and clock remain in the actual native Studio. */
export function OwnedProjectBrowser(){
 const [page,setPage]=useState<OwnedProjectsPage|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
 const [openingProjectId,setOpening]=useState<string|null>(null);
 const serial=useRef(0),opening=useRef(false);
 const load=useCallback(async(after:string|null)=>{
  if(opening.current)return;
  const request=++serial.current;setLoading(true);setError(null);
  try{const next=await readOwnedProjects(after);if(serial.current===request)setPage(next);}
  catch{if(serial.current===request)setError('工程列表暂不可用，请刷新；会话失效时请从本机启动入口重新打开。');}
  finally{if(serial.current===request)setLoading(false);}
 },[]);
 useEffect(()=>{void load(null);return()=>{serial.current++;};},[load]);
 const open=async(projectId:string)=>{
  if(opening.current||loading||!page?.projects.some(p=>p.project_id===projectId&&p.state==='saved'))return;
  opening.current=true;setOpening(projectId);setError(null);const request=++serial.current;
  try{const entry=await openOwnedProject(projectId);if(serial.current===request)window.location.assign(entry.url);}
  catch{if(serial.current===request)setError('工程暂时无法打开，请刷新状态后重试。');}
  finally{if(serial.current===request){opening.current=false;setOpening(null);}}
 };
 return <div data-owned-projects={loading?'loading':error?'error':'ready'}><OwnedProjectEntry projects={page?.projects??[]} loading={loading} error={error} openingProjectId={openingProjectId} hasNext={!!page?.next_after} onReload={()=>void load(null)} onNext={()=>{if(page?.next_after)void load(page.next_after);}} onOpen={id=>void open(id)}/></div>;
}
