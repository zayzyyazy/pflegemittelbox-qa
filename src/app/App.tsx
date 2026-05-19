import { useEffect, useState } from 'react';
import { Sidebar, type PageKey } from '../components/layout/Sidebar';
import { DashboardPage } from '../pages/DashboardPage';
import { CallsPage } from '../pages/CallsPage';
import { IssuesPage } from '../pages/IssuesPage';
import { ExperimentsPage } from '../pages/ExperimentsPage';
import { InsightsPage } from '../pages/InsightsPage';
import { MeetingPrepPage } from '../pages/MeetingPrepPage';
import { MemoryPage } from '../pages/MemoryPage';
import { SettingsPage } from '../pages/SettingsPage';
import { loadDb, saveDb, type Database } from '../services/storageService';
export default function App() { const [page,setPage]=useState<PageKey>('dashboard'); const [collapsed,setCollapsed]=useState(false); const [selectedIssue,setSelectedIssue]=useState<string|undefined>(); const [db,setDbState]=useState<Database>(()=>loadDb()); const setDb=(next:Database)=>{setDbState(next); saveDb(next);}; useEffect(()=>saveDb(db),[db]); function openIssue(id:string){setSelectedIssue(id); setPage('issues');} return <div className="app"><Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed}/><div className="content">{page==='dashboard'&&<DashboardPage db={db} setDb={setDb} openIssue={openIssue}/>} {page==='calls'&&<CallsPage db={db} setDb={setDb}/>} {page==='issues'&&<IssuesPage db={db} setDb={setDb} selectedIssueId={selectedIssue} clearSelected={()=>setSelectedIssue(undefined)}/>} {page==='experiments'&&<ExperimentsPage db={db} setDb={setDb}/>} {page==='insights'&&<InsightsPage db={db} setDb={setDb}/>} {page==='meeting'&&<MeetingPrepPage db={db}/>} {page==='memory'&&<MemoryPage db={db} setDb={setDb}/>} {page==='settings'&&<SettingsPage db={db} setDb={setDb}/>}</div></div>; }
