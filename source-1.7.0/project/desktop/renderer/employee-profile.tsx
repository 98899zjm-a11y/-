import { useEffect, useRef, useState } from "react";
import { Camera, Check, FileCheck2, Loader2, Pencil, RefreshCw, Save, Users, X } from "lucide-react";
import { api } from "./bridge";
import { collaborationError, collaborationTime, type CollaborationUser } from "./collaboration-types";
import { StaffAvatar, useStaffAvatarStore } from "./staff-avatar";
import "./collaboration.css";
import "./employee-profile.css";

export type EmployeeProfileRecord = { staffId: string; name: string; role: string; active: boolean; age: number | null; bio: string; avatar: { id: string; url: string } | null; revision: number; updatedAt: string | null; canEdit: boolean };
export type EmployeeProfileReply = { profile: EmployeeProfileRecord; month: string; published: boolean; publication: { month: string; version: number; publishedAt: string; publishedName: string } | null; sourceNote: string; summary: { orderCount: number; amountCents: string; amount: number; weightMicros: string; weight: number } };
export function profileUpdateInput(revision: number, age: string, bio: string) {
  const numericAge = age.trim() === "" ? null : Number(age);
  if (numericAge !== null && (!/^\d+$/.test(age.trim()) || !Number.isInteger(numericAge) || numericAge < 1 || numericAge > 120)) throw new Error("年龄须为1至120的整数，或留空。");
  if (bio.length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(bio)) throw new Error("简介最多600字，不能包含控制字符。");
  return { revision, age: numericAge, bio };
}
type AvatarMime = "image/png" | "image/jpeg" | "image/webp";
type AvatarHeader = { mime: AvatarMime; width?: number; height?: number };
type DecodedAvatar = { image: CanvasImageSource; width: number; height: number; dispose: () => void };
type AvatarBrowser = {
  readHeader: (file: File, maximum: number) => Promise<ArrayBuffer | Uint8Array>;
  decode: (file: File) => Promise<DecodedAvatar>;
  encode: (image: CanvasImageSource, width: number, height: number, mime: "image/png" | "image/jpeg") => Promise<{ mime: string; bytes: Uint8Array }>;
};
const SOURCE_BYTES = 12 * 1024 * 1024, SOURCE_PIXELS = 24_000_000, OUTPUT_BYTES = 2 * 1024 * 1024;
// A bounded header probe can reject a huge image before its ordinary browser decoder allocates pixels.
// This is a client convenience; the server independently validates every uploaded normalized image.
export function inspectAvatarHeader(input: ArrayBuffer | Uint8Array): AvatarHeader {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input), view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const ascii = (at: number, size: number) => String.fromCharCode(...bytes.subarray(at,at+size));
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte) && ascii(12,4)==="IHDR") return { mime:"image/png",width:view.getUint32(16),height:view.getUint32(20) };
  if (bytes.length >= 2 && bytes[0]===255 && bytes[1]===216) {
    let offset=2;
    while(offset+4<=bytes.length){
      if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;const marker=bytes[offset++];
      if(marker===218||marker===217||offset+2>bytes.length)break;
      if(marker===1||marker>=208&&marker<=215)continue;
      const size=view.getUint16(offset);if(size<2||offset+size>bytes.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&size>=8)return{mime:"image/jpeg",width:view.getUint16(offset+5),height:view.getUint16(offset+3)};
      offset+=size;
    }
    return {mime:"image/jpeg"};
  }
  if(bytes.length>=12&&ascii(0,4)==="RIFF"&&ascii(8,4)==="WEBP"){
    let offset=12;const uint24=(at:number)=>bytes[at]+(bytes[at+1]<<8)+(bytes[at+2]<<16);
    while(offset+8<=bytes.length){const name=ascii(offset,4),size=view.getUint32(offset+4,true),body=offset+8;if(body+size>bytes.length)break;
      if(name==="VP8X"&&size>=10)return{mime:"image/webp",width:1+uint24(body+4),height:1+uint24(body+7)};
      if(name==="VP8 "&&size>=10)return{mime:"image/webp",width:view.getUint16(body+6,true)&16383,height:view.getUint16(body+8,true)&16383};
      if(name==="VP8L"&&size>=5){const bits=view.getUint32(body+1,true);return{mime:"image/webp",width:(bits&16383)+1,height:((bits>>>14)&16383)+1};}
      offset=body+size+(size%2);
    }
    return{mime:"image/webp"};
  }
  throw new Error("头像文件内容无法识别，请选择完整的PNG、JPEG或WebP图片。");
}
const avatarBrowser: AvatarBrowser = {
  readHeader: (file,maximum)=>file.slice(0,maximum).arrayBuffer(),
  async decode(file){
    const source=URL.createObjectURL(file);
    try{const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const picture=new Image();picture.onload=()=>resolve(picture);picture.onerror=()=>reject(new Error("图片无法解码"));picture.src=source;});return{image,width:image.naturalWidth,height:image.naturalHeight,dispose:()=>URL.revokeObjectURL(source)};}
    catch(error){URL.revokeObjectURL(source);throw error;}
  },
  async encode(image,width,height,mime){
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d");
    if(!context)throw new Error("浏览器图像处理未就绪");context.drawImage(image,0,0,width,height);
    const blob=await new Promise<Blob>((resolve,reject)=>{canvas.toBlob(value=>value?resolve(value):reject(new Error("图像编码失败")),mime,.88);});
    return{mime:blob.type,bytes:new Uint8Array(await blob.arrayBuffer())};
  }
};
function sourceDimensions(width: number, height: number) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw new Error("头像图片尺寸无效，请重新选择。");
  if(width*height>SOURCE_PIXELS)throw new Error("原照片最多2400万像素（24MP），请选择普通分辨率照片。");
}
export async function readEmployeeAvatar(file: File,browser:AvatarBrowser=avatarBrowser): Promise<string> {
  if(/^image\/hei[cf]$/.test(file.type)||/\.hei[cf]$/i.test(file.name||""))throw new Error("暂不支持HEIC或HEIF照片，请在手机相册另存为JPEG后选择。");
  if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("头像请选择PNG、JPEG或WebP图片，不支持SVG。");
  if(!Number.isFinite(file.size)||file.size<=0||file.size>SOURCE_BYTES)throw new Error("原照片文件最多12MB，请选择较小的照片。");
  let header:ArrayBuffer|Uint8Array;try{header=await browser.readHeader(file,65536);}catch{throw new Error("头像文件读取失败，请重新选择。");}
  const metadata=inspectAvatarHeader(header);if(metadata.mime!==file.type)throw new Error("头像文件内容与图片格式不一致，请重新选择。");
  if(metadata.width!==undefined&&metadata.height!==undefined)sourceDimensions(metadata.width,metadata.height);
  let picture:DecodedAvatar;try{picture=await browser.decode(file);}catch{throw new Error("此照片无法解码或浏览器不支持，请选择完整的JPEG、PNG或WebP图片。");}
  try{
    sourceDimensions(picture.width,picture.height);const scale=Math.min(1,512/Math.max(picture.width,picture.height)),width=Math.max(1,Math.round(picture.width*scale)),height=Math.max(1,Math.round(picture.height*scale));
    let encoded:{mime:string;bytes:Uint8Array};try{encoded=await browser.encode(picture.image,width,height,file.type==="image/png"?"image/png":"image/jpeg");}catch{throw new Error("头像重新编码失败，请重试或更换照片。");}
    if(!["image/png","image/jpeg"].includes(encoded.mime)||!encoded.bytes?.byteLength)throw new Error("头像重新编码失败，请更换照片。");
    if(encoded.bytes.byteLength>OUTPUT_BYTES)throw new Error("处理后的头像超过2MB，请更换照片。");
    let binary="";for(let offset=0;offset<encoded.bytes.length;offset+=16384)binary+=String.fromCharCode(...encoded.bytes.subarray(offset,offset+16384));
    return`data:${encoded.mime};base64,${btoa(binary)}`;
  }finally{picture.dispose();}
}
const amount = (value: number) => Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const weight = (value: number) => Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 3, maximumFractionDigits: 6 });
export function EmployeeProfileCard({ reply, busy = false, onEdit, onAvatar }: { reply: EmployeeProfileReply; busy?: boolean; onEdit?: () => void; onAvatar?: (file: File) => void }) {
  const { profile, summary, publication } = reply;
  return <article className="employee-profile-card">
    <div className="employee-profile-cover"><span>THE PEOPLE OF OUR ATELIER</span><span className="employee-profile-cover-mark">一份热爱，一路相伴。</span></div>
    <header className="employee-profile-identity">
      <StaffAvatar staffId={profile.staffId} name={profile.name} className="employee-profile-avatar"/>
      <div className="employee-profile-name"><span>{profile.role === "admin" ? "工作室管理员" : "珠宝顾问"}{!profile.active && " · 账号已停用"}</span><h2>{profile.name}</h2><p>{profile.age !== null && <span>{profile.age} 岁</span>}<span>鑫金源 · 同事个人主页</span></p></div>
      {profile.canEdit && <div className="employee-profile-actions"><button className="button" disabled={busy} onClick={onEdit}><Pencil size={14}/>编辑资料</button><label className={`button ${busy ? "employee-profile-upload-busy" : ""}`}><Camera size={14}/>更换头像<input type="file" aria-label="更换个人头像" accept="image/png,image/jpeg,image/webp" hidden disabled={busy} onChange={event => { const file=event.target.files?.[0];event.currentTarget.value="";if(file)onAvatar?.(file); }}/></label></div>}
    </header>
    <section className="employee-profile-about"><small>ABOUT ME</small><h3>关于我</h3><p>{profile.bio || "还没有填写个人简介。"}</p></section>
    <section className="employee-profile-achievements"><header><div><small>MY PUBLISHED ACHIEVEMENTS</small><h3>{reply.month.replace("-"," 年 ")} 月的成果</h3></div><span className="tag"><FileCheck2 size={12}/>{publication ? `已核定发布 · V${publication.version}` : "等待财务发布"}</span></header>
      <div className="employee-profile-metrics"><section><small>已发布销售单数</small><strong>{reply.published ? summary.orderCount.toLocaleString("zh-CN") : "—"}<em>单</em></strong><span>按财务原销售记录笔数</span></section><section><small>已发布销售金额</small><strong>{reply.published ? `¥${amount(summary.amount)}` : "—"}</strong><span>核定的实际销售金额</span></section><section><small>已发布销售克重</small><strong>{reply.published ? weight(summary.weight) : "—"}<em>克</em></strong><span>按财务原值精确汇总</span></section></div>
      {publication ? <div className="employee-profile-source"><Check size={14}/><div><strong>{publication.publishedName} · 财务核定发布</strong><p>发布于 {collaborationTime(publication.publishedAt)}</p><p>{reply.sourceNote}</p></div></div> : <p className="employee-profile-awaiting">本月成果尚未发布。财务核对完成后，这里会呈现本人的销售单数、金额与克重。</p>}
    </section>
  </article>;
}

export default function EmployeeProfile({ user }: { user: CollaborationUser }) {
  const avatars = useStaffAvatarStore();
  const [profiles,setProfiles]=useState<EmployeeProfileRecord[]>([]), [selectedId,setSelectedId]=useState(user.id), [month,setMonth]=useState(new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Shanghai"}).slice(0,7));
  const [reply,setReply]=useState<EmployeeProfileReply|null>(null), [reload,setReload]=useState(0), [loading,setLoading]=useState(true), [busy,setBusy]=useState(false), [editing,setEditing]=useState(false);
  const [editAge,setEditAge]=useState(""), [editBio,setEditBio]=useState(""), [error,setError]=useState(""), [notice,setNotice]=useState(""), [search,setSearch]=useState("");
  const working=useRef(false), scope=useRef(0);
  useEffect(()=>{let current=true;api<{profiles:EmployeeProfileRecord[]}>("/api/employee-profiles").then(result=>{if(current){setProfiles(result.profiles);avatars?.seed(result.profiles);}}).catch(problem=>{if(current)setError(collaborationError(problem));});return()=>{current=false;};},[user.id,user.grantRevision,reload,avatars]);
  useEffect(()=>{
    let current=true;scope.current++;setReply(null);setEditing(false);setLoading(true);setError("");
    api<EmployeeProfileReply>(`/api/employee-profiles/${selectedId}?month=${encodeURIComponent(month)}`).then(result=>{if(current){setReply(result);avatars?.seed([result.profile]);}}).catch(problem=>{if(current)setError(collaborationError(problem));}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;scope.current++;};
  },[selectedId,month,reload,user.id,user.grantRevision,avatars]);
  const applyProfile=(profile:EmployeeProfileRecord)=>{avatars?.publish(profile);setReply(current=>current&&current.profile.staffId===profile.staffId?{...current,profile}:current);setProfiles(current=>current.map(item=>item.staffId===profile.staffId?profile:item));};
  const save=async()=>{
    if(working.current||!reply?.profile.canEdit)return;const requestScope=scope.current,profile=reply.profile;working.current=true;setBusy(true);setError("");setNotice("");
    try{const result=await api<{profile:EmployeeProfileRecord}>(`/api/employee-profiles/${profile.staffId}`,"PATCH",profileUpdateInput(profile.revision,editAge,editBio));if(requestScope===scope.current){applyProfile(result.profile);setEditing(false);setNotice("个人资料已保存。");}}
    catch(problem){if(requestScope===scope.current)setError(collaborationError(problem));}finally{working.current=false;setBusy(false);}
  };
  const upload=async(file:File)=>{
    if(working.current||!reply?.profile.canEdit)return;const requestScope=scope.current,profile=reply.profile;working.current=true;setBusy(true);setError("");setNotice("");
    try{const image=await readEmployeeAvatar(file);const result=await api<{profile:EmployeeProfileRecord}>(`/api/employee-profiles/${profile.staffId}/avatar`,"POST",{revision:profile.revision,image});if(requestScope===scope.current){applyProfile(result.profile);setNotice("头像已保存。");}}
    catch(problem){if(requestScope===scope.current)setError(collaborationError(problem));}finally{working.current=false;setBusy(false);}
  };
  const select=(id:string)=>{if(!busy){setSelectedId(id);setNotice("");setError("");}};
  const beginEdit=()=>{if(!reply||busy)return;setEditAge(reply.profile.age===null?"":String(reply.profile.age));setEditBio(reply.profile.bio);setEditing(true);setNotice("");};
  const options=profiles.filter(profile=>profile.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <div className="employee-profile-page collaboration-page">
    <header className="collaboration-heading"><div><span>OUR PEOPLE, THEIR STORIES</span><h2>个人主页</h2><p>记录自己的故事，也看看同事们已发布的成果。</p></div><button className="button" disabled={loading||busy} onClick={()=>{setNotice("");setReload(value=>value+1);void avatars?.refresh();}}><RefreshCw size={14}/>刷新</button></header>
    <div className="employee-profile-toolbar"><label>查看同事<select aria-label="个人主页员工" value={selectedId} disabled={busy} onChange={event=>select(event.target.value)}>{profiles.map(profile=><option key={profile.staffId} value={profile.staffId}>{profile.name}{profile.staffId===user.id?" · 我":""}{!profile.active?" · 已停用":""}</option>)}</select></label><label>成果月份<input aria-label="个人主页成果月份" type="month" min="2000-01" max="2200-12" value={month} disabled={busy} onChange={event=>{if(event.target.value){setMonth(event.target.value);setNotice("");}}}/></label><button className={`button ${selectedId===user.id?"employee-profile-own-active":""}`} disabled={busy||selectedId===user.id} onClick={()=>select(user.id)}>我的主页</button></div>
    {error&&<p className="collaboration-feedback error" role="alert">{error}</p>}{notice&&<p className="collaboration-feedback success" role="status"><Check size={14}/>{notice}</p>}
    <div className="employee-profile-layout"><aside className="employee-profile-directory" aria-label="公司员工个人主页"><h3><Users size={16}/>工作室同事</h3><input type="search" aria-label="搜索同事个人主页" placeholder="搜索同事姓名" value={search} onChange={event=>setSearch(event.target.value)}/><div>{options.map(profile=><button key={profile.staffId} aria-current={selectedId===profile.staffId?"page":undefined} className={selectedId===profile.staffId?"active":""} disabled={busy} onClick={()=>select(profile.staffId)}><StaffAvatar staffId={profile.staffId} name={profile.name}/><div><strong>{profile.name}{profile.staffId===user.id&&<em>我</em>}</strong><small>{profile.active?(profile.role==="admin"?"管理员":"珠宝顾问"):"账号已停用"}</small></div></button>)}{!options.length&&<p>没有找到这位同事。</p>}</div></aside>
      <div className="employee-profile-main" aria-busy={loading||busy}>{loading?<div className="collaboration-empty" role="status"><Loader2 className="spin" size={22}/><p>正在读取个人主页…</p></div>:reply&&<><EmployeeProfileCard reply={reply} busy={busy} onEdit={beginEdit} onAvatar={file=>void upload(file)}/>{editing&&reply.profile.canEdit&&<form className="employee-profile-editor" onSubmit={event=>{event.preventDefault();void save();}}><header><h3>编辑个人资料</h3><button type="button" className="icon-button" aria-label="关闭个人资料编辑" disabled={busy} onClick={()=>setEditing(false)}><X size={17}/></button></header><p>年龄和简介会显示在公司员工可见的个人主页。</p><label>年龄 <input aria-label="个人年龄" type="number" min={1} max={120} step={1} placeholder="可留空" value={editAge} disabled={busy} onChange={event=>setEditAge(event.target.value)}/></label><label>个人简介<textarea aria-label="个人简介" rows={5} maxLength={600} placeholder="写一点关于自己的故事、喜好或服务理念…" value={editBio} disabled={busy} onChange={event=>setEditBio(event.target.value)}/><small>{editBio.length} / 600</small></label><footer><button type="button" className="button" disabled={busy} onClick={()=>setEditing(false)}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy?<Loader2 size={14} className="spin"/>:<Save size={14}/>}保存资料</button></footer></form>}</>}
      </div>
    </div>
  </div>;
}
