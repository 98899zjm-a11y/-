import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import WarrantyDocument, { prepareWarrantyDocument, type WarrantyData } from "../renderer/warranty-document";
import "@/app/globals.css";

declare global { interface Window { __xjyWarrantyFixture: { ready: boolean; pages: number; error?: string; mode: string }; } }
const data: WarrantyData = { phone:"13800000000", date:"2026-10-10", goodsNumber:"XJY-TEST-001", productName:"铂金蛇骨链", weight:"3.520克", standard:"GB/T 11887", quantity:"1件", amount:"1865.60", total:"1865.60", afterSalesWechat:"test-wechat" };
const mode = new URLSearchParams(window.location.search).get("mode") === "fields" ? "fields" : "full";
window.__xjyWarrantyFixture = { ready: false, pages: 1, mode };
function Fixture() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { let active=true; void (async()=> { try { if (!root.current) throw new Error("模板没有挂载"); await prepareWarrantyDocument(root.current); if (active) window.__xjyWarrantyFixture={ready:true,pages:1,mode}; } catch(error) { window.__xjyWarrantyFixture={ready:false,pages:1,mode,error:error instanceof Error ? error.message : "模板加载失败"}; } })(); return()=>{active=false}; },[]);
  return createPortal(<div ref={root} className="warranty-print-root"><WarrantyDocument data={data} mode={mode} /></div>,document.body);
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
