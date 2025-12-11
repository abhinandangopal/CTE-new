/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { useState, useMemo, useRef, useEffect } from 'react';
import useWebSocket from 'react-use-websocket';
import ReactQuill, { Quill } from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css'; 
import { saveAs } from 'file-saver';
import { asBlob } from 'html-docx-js-typescript';
import QuillCursors from 'quill-cursors';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// @ts-ignore
import html2pdf from 'html2pdf.js';

Quill.register('modules/cursors', QuillCursors);

const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) { hash = str.charCodeAt(i) + ((hash << 5) - hash); }
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
};

const API_URL = 'http://localhost:8081/api';

function App() {
  const params = new URLSearchParams(window.location.search);
  const initialDoc = params.get('doc') || "";
  const resetToken = params.get('resetToken');

  const [view, setView] = useState<'login' | 'dashboard' | 'editor' | 'forgot_password' | 'reset_password'>('login');
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState(localStorage.getItem('user_email') || "");
  const [tempEmail, setTempEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [myDocs, setMyDocs] = useState<string[]>([]);
  
  const [docId, setDocId] = useState(initialDoc);
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<any[]>([]); 
  const [showHistory, setShowHistory] = useState(false);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [replyQuote, setReplyQuote] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");
  const [darkMode, setDarkMode] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  
  const [myRole, setMyRole] = useState<string>(""); 
  const canEditText = myRole === 'owner' || myRole === 'editor';
  const canChat = myRole !== 'viewer';
  const isOwner = myRole === 'owner';

  const [showShareModal, setShowShareModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const [collaborators, setCollaborators] = useState<{[email:string]: string}>({});
  const [linkAccessSetting, setLinkAccessSetting] = useState<string>("none");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<any>(null);

  const fetchMyDocs = async (userEmail: string) => { try { const res = await fetch(`${API_URL}/docs/${userEmail}`); setMyDocs(await res.json()); } catch (e) { console.error(e); } };
  const fetchTabs = async (id: string) => { try { const res = await fetch(`${API_URL}/doc/${id}/tabs`); const list = await res.json(); setTabs(list); if (list.length > 0) setActiveTab(list[0]); } catch (e) { console.error(e); } };
  const fetchPermissions = async () => { try { const res = await fetch(`${API_URL}/doc/${docId}/users`); const data = await res.json(); setCollaborators(data.acl); setLinkAccessSetting(data.linkAccess); } catch (e) { console.error(e); } };

  useEffect(() => {
    if (resetToken) { setView('reset_password'); return; }
    const savedEmail = localStorage.getItem('user_email');
    if (savedEmail) {
        setEmail(savedEmail);
        if (initialDoc) { setDocId(initialDoc); setView('editor'); fetchTabs(initialDoc); } 
        else { setView('dashboard'); fetchMyDocs(savedEmail); }
    }
  }, []);

  useEffect(() => { if (showShareModal && docId) fetchPermissions(); }, [showShareModal, docId]);

  const USER_ID = email; 
  const USER_COLOR = stringToColor(USER_ID);
  const WS_URL = (view === 'editor' && docId && activeTab) ? `ws://localhost:8081?docId=${docId}&tabId=${activeTab}&userId=${USER_ID}` : null;

  const { sendMessage } = useWebSocket(WS_URL, {
    onOpen: () => console.log(`Connected`),
    shouldReconnect: () => true,
    onMessage: (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'typing' && data.isTyping) {
                setTypingUsers(prev => new Set(prev).add(data.userId));
                setTimeout(() => { setTypingUsers(prev => { const newSet = new Set(prev); newSet.delete(data.userId); return newSet; }); }, 2000);
            }
            if (data.type === 'access_info') setMyRole(data.role);
            if (data.type === 'error') { alert(data.message); backToDashboard(); }
            if (data.type === 'user_list') setActiveUsers(data.list);
            if (data.type === 'system') toast.info(data.message, { autoClose: 2000, position: "bottom-left" });
            if ((data.type === 'sync' || data.type === 'update') && data.userId !== USER_ID && data.content !== undefined) setValue(data.content);
            if (data.type === 'history_list') { setHistory(data.list); setShowHistory(true); }
            if (data.type === 'chat_history') setChatMessages(data.list);
            if (data.type === 'cursor' && data.userId !== USER_ID && quillRef.current) {
                const editor = quillRef.current.getEditor(); const cursors = editor.getModule('cursors'); cursors.createCursor(data.userId, data.userId, stringToColor(data.userId)); cursors.moveCursor(data.userId, data.range); cursors.toggleFlag(data.userId, true);
            }
        } catch (e) { console.error(e); }
    }
  });

  useEffect(() => { setValue(""); setChatMessages([]); setActiveUsers([]); }, [activeTab]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const handleAuth = async (e: React.FormEvent) => { 
      e.preventDefault(); 
      if (!tempEmail.includes('@') || !tempPassword) return toast.warning("Email & Password required");
      
      if (isSignUp) {
          const hasUpperCase = /[A-Z]/.test(tempPassword);
          const hasLowerCase = /[a-z]/.test(tempPassword);
          const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(tempPassword);
          if (!hasUpperCase || !hasLowerCase || !hasSpecial) {
              toast.error("Password must contain at least: 1 Uppercase, 1 Lowercase, and 1 Special character.");
              return;
          }
      }

      const endpoint = isSignUp ? '/signup' : '/login';
      try {
          const res = await fetch(`${API_URL}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: tempEmail, password: tempPassword })
          });
          const data = await res.json();
          if (!res.ok) { toast.error(data.error || "Auth Failed"); return; }
          localStorage.setItem('user_email', tempEmail);
          setEmail(tempEmail);
          setView('dashboard');
          fetchMyDocs(tempEmail);
          toast.success(`Welcome ${isSignUp ? 'New User' : 'Back'}!`);
      } catch (err) { toast.error("Connection Error"); }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!tempEmail.includes('@')) return toast.warning("Enter a valid email");
      try {
          const res = await fetch(`${API_URL}/forgot-password`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ email: tempEmail })
          });
          const data = await res.json();
          if(data.success) {
              toast.success("Check your email for the reset link!");
              setView('login');
          } else { toast.error(data.error); }
      } catch(e) { toast.error("Error sending email"); }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!resetToken || !tempPassword) return;
      try {
          const res = await fetch(`${API_URL}/reset-password`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ token: resetToken, newPassword: tempPassword })
          });
          const data = await res.json();
          if(data.success) {
              toast.success("Password Reset! Please Login.");
              window.history.pushState({}, '', '/'); 
              setView('login');
          } else { toast.error(data.error); }
      } catch(e) { toast.error("Error resetting password"); }
  };

  const handleLogout = () => { localStorage.removeItem('user_email'); setEmail(""); setView('login'); setTempPassword(""); window.history.pushState({}, '', `/`); };
  const backToDashboard = () => { setView('dashboard'); window.history.pushState({}, '', `/`); fetchMyDocs(email); };
  
  const handleChange = (content: string, _delta: any, source: string, editor: any) => { if (source === 'user' && canEditText) { setValue(content); sendMessage(JSON.stringify({ type: 'update', content: content, userId: USER_ID })); const range = editor.getSelection(); if (range) sendMessage(JSON.stringify({ type: 'cursor', range: range, userId: USER_ID, color: USER_COLOR })); const text = editor.getText(); setCharCount(text.length - 1); setWordCount(text.trim().split(/\s+/).filter((w:string) => w.length > 0).length); sendMessage(JSON.stringify({ type: 'typing', isTyping: true, userId: USER_ID })); } };
  const fetchHistory = () => sendMessage(JSON.stringify({ type: 'fetch_history' }));
  const restoreVersion = (c: string) => { if(confirm("Restore?")) { setValue(c); sendMessage(JSON.stringify({ type: 'restore', content: c })); setShowHistory(false); }};
  
  // 🟢 FIX: Updated PDF Export to ignore TS errors
  const exportToPDF = () => { 
      if (!quillRef.current) return; 
      const element = document.querySelector('.ql-editor'); 
      if (!element) return; 
      
      const opt: any = { 
          margin: 10, 
          filename: `${docId}.pdf`, 
          image: { type: 'jpeg', quality: 0.98 }, 
          html2canvas: { scale: 2 }, 
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } 
      }; 
      
      // @ts-ignore
      html2pdf().from(element).set(opt).save(); 
  };

  const exportToWord = () => { const h = `<!DOCTYPE html><head><title>${docId}</title></head><body>${value}</body></html>`; asBlob(h).then((d: any) => saveAs(d as Blob, `${docId}.docx`)); };
  const copyLink = () => { navigator.clipboard.writeText(`${window.location.origin}/?doc=${docId}`); toast.success("Link copied!"); };
  const handleUpdateUser = async (targetEmail: string, newRole: string) => { try { await fetch(`${API_URL}/doc/${docId}/user`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, ownerId: email, email: targetEmail, role: newRole }) }); toast.success(`Updated`); fetchPermissions(); setInviteEmail(""); } catch(e) { toast.error("Error"); }};
  const handleRevokeUser = async (targetEmail: string) => { if(!confirm(`Remove?`)) return; try { await fetch(`${API_URL}/doc/${docId}/user`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, ownerId: email, email: targetEmail }) }); toast.success(`Removed`); fetchPermissions(); } catch(e) { toast.error("Error"); }};
  const handleLinkSettingChange = async (newSetting: string) => { try { await fetch(`${API_URL}/doc/${docId}/link-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docId, ownerId: email, linkAccess: newSetting }) }); setLinkAccessSetting(newSetting); toast.success("Updated"); } catch(e) { toast.error("Error"); }};
  const addNewTab = async () => { const name = prompt("Tab Name:"); if (!name) return; await fetch(`${API_URL}/doc/${docId}/tabs`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ docId, tabName: name }) }); setTabs(prev => [...prev, name]); setActiveTab(name); };
  const createNewDoc = async () => { const newDocName = prompt("Doc Name:"); if (!newDocName) return; await fetch(`${API_URL}/docs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: email, docId: newDocName }) }); setDocId(newDocName); setView('editor'); window.history.pushState({}, '', `/?doc=${newDocName}`); fetchTabs(newDocName); };
  const openDoc = (id: string) => { setDocId(id); setView('editor'); window.history.pushState({}, '', `/?doc=${id}`); fetchTabs(id); };
  const sendChat = () => { if(chatInput.trim()) { sendMessage(JSON.stringify({ type: 'chat', message: chatInput, quote: replyQuote, color: USER_COLOR })); setChatInput(""); setReplyQuote(null); }};
  const deleteChat = (id: number) => { if(confirm("Delete?")) sendMessage(JSON.stringify({ type: 'delete_chat', chatId: id })); };
  const quoteSelection = () => { const editor = quillRef.current?.getEditor(); const range = editor?.getSelection(); if(range && range.length > 0) { setReplyQuote(editor.getText(range.index, range.length)); } else { toast.warning("Highlight text to quote!"); }};
  const modules = useMemo(() => ({ cursors: true, toolbar: canEditText ? [[{ 'header': [1, 2, 3, false] }], [{ 'size': ['small', false, 'large', 'huge'] }], ['bold', 'italic', 'underline', 'strike'], [{ 'color': [] }, { 'background': [] }], [{ 'align': [] }], [{ 'list': 'ordered'}, { 'list': 'bullet' }], ['clean']] : false, clipboard: { matchVisual: false } }), [canEditText]);
  const bgMain = darkMode ? '#1e1e1e' : '#f0f0f0'; const bgPanel = darkMode ? '#2d2d2d' : 'white'; const textMain = darkMode ? '#e0e0e0' : 'black'; const borderCol = darkMode ? '#444' : '#ddd'; const modalOverlayStyle: React.CSSProperties = { position:'fixed', top:0, left:0, width:'100%', height:'100%', backgroundColor:'rgba(0,0,0,0.5)', display:'flex', justifyContent:'center', alignItems:'center', zIndex:2000 }; const modalBoxStyle: React.CSSProperties = { backgroundColor: bgPanel, color: textMain, padding:'25px', borderRadius:'12px', width:'500px', boxShadow:'0 10px 25px rgba(0,0,0,0.2)' };
  
  if (view === 'forgot_password') return (
    <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#eef2f3' }}>
        <ToastContainer position="top-right" autoClose={3000} />
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '10px', width: '320px', textAlign: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
            <h2 style={{color: '#333', marginBottom: '10px'}}>Reset Password</h2>
            <p style={{marginBottom: '20px', color:'#666', fontSize:'14px'}}>Enter your email to receive a reset link.</p>
            <form onSubmit={handleForgotPassword}>
                <input type="email" placeholder="Email Address" value={tempEmail} onChange={(e) => setTempEmail(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '20px', borderRadius: '5px', border: '1px solid #ccc' }} required />
                <button type="submit" style={{ width: '100%', padding: '12px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold', cursor: 'pointer' }}>Send Link</button>
            </form>
            <p style={{marginTop:'15px', fontSize:'14px', cursor:'pointer', color:'#007bff', textDecoration: 'underline'}} onClick={() => setView('login')}>Back to Login</p>
        </div>
    </div>
  );

  if (view === 'reset_password') return (
    <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#eef2f3' }}>
        <ToastContainer position="top-right" autoClose={3000} />
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '10px', width: '320px', textAlign: 'center', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' }}>
            <h2 style={{color: '#333', marginBottom: '20px'}}>New Password</h2>
            <form onSubmit={handleResetSubmit}>
                <input type="password" placeholder="New Password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '20px', borderRadius: '5px', border: '1px solid #ccc' }} required />
                <button type="submit" style={{ width: '100%', padding: '12px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', fontWeight: 'bold', cursor: 'pointer' }}>Update Password</button>
            </form>
        </div>
    </div>
  );

  if (view === 'login') return ( 
    <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: '#eef2f3' }}> 
        <ToastContainer position="top-right" autoClose={3000} />
        <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)', textAlign: 'center', width: '320px' }}>
            <h2 style={{ marginBottom: '20px', color: '#333' }}>{isSignUp ? 'Sign Up' : 'Login'}</h2>
            <form onSubmit={handleAuth}>
                <input type="email" placeholder="Email Address" value={tempEmail} onChange={(e) => setTempEmail(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '15px', borderRadius: '5px', border: '1px solid #ccc' }} required />
                <input type="password" placeholder="Password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '20px', borderRadius: '5px', border: '1px solid #ccc' }} required />
                <button type="submit" style={{ width: '100%', padding: '12px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>
                    {isSignUp ? 'Create Account' : 'Sign In'}
                </button>
            </form>
            
            {/* 🟢 THIS LOGIC SHOWS/HIDES THE LINK */}
            {!isSignUp && (
                <p 
                    style={{ marginTop: '15px', fontSize: '13px', color: '#007bff', cursor: 'pointer', textDecoration: 'underline' }} 
                    onClick={() => setView('forgot_password')}
                >
                    Forgot Password?
                </p>
            )}

            <p style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
                {isSignUp ? "Already have an account?" : "Need an account?"} 
                <span onClick={() => setIsSignUp(!isSignUp)} style={{ color: '#007bff', cursor: 'pointer', fontWeight: 'bold', marginLeft: '5px' }}>
                    {isSignUp ? "Login" : "Sign Up"}
                </span>
            </p>
        </div> 
    </div> 
  );

  if (view === 'dashboard') return ( <div style={{ height: '100vh', backgroundColor: '#f8f9fa', padding: '40px' }}> <div style={{ maxWidth: '800px', margin: '0 auto' }}> <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '40px' }}><h1>👋 Hello, {email}</h1><button onClick={handleLogout} style={{ padding: '8px 16px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>Logout</button></div> <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px' }}> <div onClick={createNewDoc} style={{ height: '150px', border: '2px dashed #ccc', borderRadius: '10px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', backgroundColor: 'white' }}><span style={{ fontSize: '40px', color: '#28a745' }}>+</span><span style={{ fontWeight: 'bold', color: '#555' }}>Create New</span></div> {myDocs.map((doc, i) => (<div key={i} onClick={() => openDoc(doc)} style={{ height: '150px', border: '1px solid #ddd', borderRadius: '10px', padding: '20px', backgroundColor: 'white', cursor: 'pointer', boxShadow: '0 2px 5px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}><h3 style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>📄 {doc}</h3><span style={{ fontSize: '12px', color: '#888' }}>Open &rarr;</span></div>))} </div> </div> </div> );

  return (
    <div style={{ padding: '2rem', fontFamily: 'Arial', backgroundColor: bgMain, color: textMain, height: '100vh', display: 'flex', flexDirection: 'column', transition: 'background-color 0.3s' }}>
      <ToastContainer />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
            <button onClick={backToDashboard} style={{marginRight:'10px', border:'none', background:'transparent', fontSize:'20px', cursor:'pointer', color: textMain}}>⬅</button>
            <h2 style={{ display: 'inline', margin: 0 }}>{docId} <span style={{fontSize:'0.5em', color:'gray'}}>({myRole})</span></h2>
            <div style={{ display: 'flex', marginLeft: '35px', marginTop:'5px' }}>{activeUsers.map((u) => (<div key={u.userId} title={u.userId} style={{ width: '30px', height: '30px', borderRadius: '50%', backgroundColor: stringToColor(u.userId), border: '2px solid white', marginLeft: '-10px', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'white', fontSize: '10px', fontWeight: 'bold' }}>{u.userId.charAt(0).toUpperCase()}</div>))}</div>
        </div>
        <div style={{display:'flex', gap:'10px', alignItems:'center'}}>
            {typingUsers.size > 0 && <span style={{fontSize:'12px', color:'#28a745', fontStyle:'italic', marginRight:'10px'}}>{Array.from(typingUsers)[0]} is typing...</span>}
            <button onClick={() => setDarkMode(!darkMode)} style={{background:'transparent', border:`1px solid ${borderCol}`, color:textMain, borderRadius:'5px', padding:'5px 10px', cursor:'pointer'}}>{darkMode ? '☀ Light' : '🌙 Dark'}</button>
            {isOwner && <button onClick={() => setShowShareModal(true)} style={{ padding: '10px 15px', backgroundColor: '#17a2b8', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>👤 Share</button>}
            <button onClick={fetchHistory} style={{ padding: '10px 15px', backgroundColor: '#6f42c1', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>🕒 History</button>
            <button onClick={exportToPDF} style={{ padding: '10px 15px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>📄 PDF</button>
            <button onClick={exportToWord} style={{ padding: '10px 15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>💾 DOCX</button>
        </div>
      </div>
      
      <div style={{ display: 'flex', gap: '5px', marginBottom: '0', paddingLeft: '10px' }}>
          {tabs.map(tab => (<div key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '8px 20px', backgroundColor: activeTab === tab ? bgPanel : '#888', color: activeTab === tab ? textMain : '#ccc', borderRadius: '8px 8px 0 0', cursor: 'pointer', fontWeight: activeTab === tab ? 'bold' : 'normal', borderBottom: activeTab === tab ? `2px solid ${bgPanel}` : 'none', zIndex: 10 }}>{tab}</div>))}
          <button onClick={addNewTab} style={{ border:'none', background:'transparent', fontSize:'20px', cursor:'pointer', color: textMain }}>+</button>
      </div>

      <div style={{ display: 'flex', gap: '20px', flex: 1, height: '70vh' }}>
        <div style={{ flex: 3, backgroundColor: !canEditText ? '#f9f9f9' : 'white', color: 'black', display: 'flex', flexDirection: 'column', borderRadius: '0 8px 8px 8px', marginTop:'-2px' }}>
            <ReactQuill ref={quillRef} theme="snow" value={value} onChange={handleChange} modules={modules} readOnly={!canEditText} style={{ flex: 1, display: 'flex', flexDirection: 'column' }} />
            <div style={{padding:'5px 10px', background:'#eee', fontSize:'12px', color:'#555', textAlign:'right', borderTop:'1px solid #ddd'}}>{wordCount} Words | {charCount} Characters</div>
        </div>
        
        <div style={{ flex: 1, backgroundColor: bgPanel, display: 'flex', flexDirection: 'column', borderRadius: '8px', overflow: 'hidden', border:`1px solid ${borderCol}` }}>
            <div style={{ padding: '10px', background: darkMode ? '#333' : '#eee', fontWeight: 'bold', borderBottom:`1px solid ${borderCol}` }}>💬 {activeTab} Chat</div>
            <div style={{ flex: 1, padding: '10px', overflowY: 'auto' }}>
                {chatMessages.map((msg, i) => (<div key={i} style={{ marginBottom: '10px' }}><div style={{display:'flex', justifyContent:'space-between'}}><strong style={{color: stringToColor(msg.user), fontSize:'12px'}}>{msg.user}</strong><span onClick={()=>deleteChat(msg.id)} style={{cursor:'pointer', color:'red'}}>×</span></div>{msg.quote && <div style={{borderLeft:'4px solid #007bff', background: darkMode ? '#333' : '#f1f8ff', padding:'4px', fontSize:'11px', fontStyle:'italic'}}>"{msg.quote}"</div>}<div style={{background: darkMode ? '#444' : '#f1f1f1', padding:'5px', borderRadius:'5px'}}>{msg.message}</div></div>))}
                <div ref={chatEndRef}/>
            </div>
            {canChat && (<div style={{ borderTop: `1px solid ${borderCol}` }}>{replyQuote && (<div style={{ padding: '8px', background: darkMode ? '#333' : '#e2e6ea', fontSize: '12px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:`1px solid ${borderCol}` }}><span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'200px'}}>Replying to: <strong>"{replyQuote}"</strong></span><button onClick={() => setReplyQuote(null)} style={{border:'none', background:'transparent', cursor:'pointer', color:'red', fontWeight:'bold'}}>×</button></div>)}<div style={{ padding: '10px', display: 'flex', gap: '5px' }}><button onClick={quoteSelection} title="Quote" style={{background:'#ddd', border:'none', cursor:'pointer', borderRadius:'3px', width:'30px', fontWeight:'bold'}}>❝</button><input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && sendChat()} style={{flex:1}} placeholder="Type..." /><button onClick={sendChat} style={{background:'#28a745', color:'white', border:'none', padding:'5px 10px'}}>➤</button></div></div>)}
            {!canChat && <div style={{padding:'10px', color:'#999', fontSize:'12px', textAlign:'center'}}>Viewers cannot chat.</div>}
        </div>

        {/* GOOGLE DOCS STYLE SHARE MODAL */}
        {showShareModal && isOwner && (
            <div style={modalOverlayStyle}>
                <div style={modalBoxStyle}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'15px'}}>
                        <h2 style={{margin:0, fontSize:'22px'}}>Share "{docId}"</h2>
                        <button onClick={() => setShowShareModal(false)} style={{border:'none', background:'transparent', fontSize:'24px', cursor:'pointer', color:textMain}}>×</button>
                    </div>
                    {/* Invite Section */}
                    <div style={{display:'flex', gap:'10px', marginBottom:'20px'}}>
                        <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Add people by email..." style={{flex:1, padding:'10px', borderRadius:'5px', border:`1px solid ${borderCol}`, backgroundColor: bgPanel, color: textMain}} />
                        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} style={{padding:'5px', borderRadius:'5px', border:`1px solid ${borderCol}`, marginLeft:'10px', backgroundColor: bgPanel, color: textMain}}>
                            <option value="editor">Editor</option><option value="commenter">Commenter</option><option value="viewer">Viewer</option>
                        </select>
                        <button onClick={() => handleUpdateUser(inviteEmail, inviteRole)} style={{padding:'10px', backgroundColor:'#007bff', color:'white', border:'none', borderRadius:'5px'}}>Invite</button>
                    </div>
                    {/* User List */}
                    <div style={{maxHeight:'200px', overflowY:'auto'}}>
                        {Object.entries(collaborators).map(([uEmail, role]) => (
                            <div key={uEmail} style={{display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom:`1px solid ${borderCol}`}}>
                                <div>{uEmail} ({role})</div>
                                {role !== 'owner' && (
                                    <div style={{display:'flex', alignItems:'center'}}>
                                        <select value={role} onChange={(e) => handleUpdateUser(uEmail, e.target.value)} style={{padding:'5px', borderRadius:'5px', border:`1px solid ${borderCol}`, marginLeft:'10px', backgroundColor: bgPanel, color: textMain}}>
                                            <option value="editor">Editor</option><option value="commenter">Commenter</option><option value="viewer">Viewer</option>
                                        </select>
                                        <button onClick={() => handleRevokeUser(uEmail)} style={{marginLeft:'10px', color:'red', border:'none', background:'transparent', cursor:'pointer'}}>Remove</button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    {/* General Access Link */}
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', background: darkMode ? '#333' : '#f8f9fa', padding:'15px', borderRadius:'8px', marginTop:'15px'}}>
                        <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                            <div style={{backgroundColor: linkAccessSetting === 'none' ? '#ccc' : '#28a745', borderRadius:'50%', width:'30px', height:'30px', display:'flex', justifyContent:'center', alignItems:'center', color:'white'}}>🌐</div>
                            <div>
                                <select value={linkAccessSetting === 'none' ? 'restricted' : 'anyone'} onChange={(e) => handleLinkSettingChange(e.target.value === 'restricted' ? 'none' : 'viewer')} style={{fontWeight:'bold', border:'none', background:'transparent', fontSize:'14px', color: textMain}}>
                                    <option value="restricted">Restricted</option><option value="anyone">Anyone with link</option>
                                </select>
                            </div>
                        </div>
                        {linkAccessSetting !== 'none' && (
                            <select value={linkAccessSetting} onChange={(e) => handleLinkSettingChange(e.target.value)} style={{padding:'5px', borderRadius:'5px', border:`1px solid ${borderCol}`, marginLeft:'10px', backgroundColor: bgPanel, color: textMain}}>
                                <option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="editor">Editor</option>
                            </select>
                        )}
                    </div>
                    <div style={{display:'flex', justifyContent:'space-between', marginTop:'25px'}}>
                         <button onClick={copyLink} style={{padding:'10px 20px', border:'1px solid #007bff', color:'#007bff', backgroundColor:'transparent', borderRadius:'20px', cursor:'pointer', fontWeight:'bold', display:'flex', alignItems:'center', gap:'5px'}}>🔗 Copy link</button>
                         <button onClick={() => setShowShareModal(false)} style={{padding:'10px 20px', backgroundColor:'#007bff', color:'white', border:'none', borderRadius:'20px', cursor:'pointer', fontWeight:'bold'}}>Done</button>
                    </div>
                </div>
            </div>
        )}
        
        {showHistory && (<div style={{ position:'absolute', top:'10%', left:'30%', width:'40%', backgroundColor: 'white', padding: '20px', borderRadius: '8px', zIndex: 1000, maxHeight: '80vh', overflowY: 'auto', boxShadow:'0 5px 15px rgba(0,0,0,0.3)' }}><h3>History</h3>{history.map((ver, i) => (<div key={i} style={{ borderBottom: '1px solid #eee', padding: '10px 0' }}><p style={{fontSize:'12px'}}>{new Date(ver.timestamp).toLocaleString()} - {ver.user}</p><button onClick={() => restoreVersion(ver.content)} style={{ backgroundColor: '#ffc107', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Restore</button></div>))}<button onClick={() => setShowHistory(false)} style={{marginTop:'10px'}}>Close</button></div>)}
      </div>
    </div>
  );
}

export default App;