"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { QuotePaper, PaperLine, PaperProduct } from "@/components/quote-card";
import "./a4-quotation.css";

export type A4QuotationProps = { papers: QuotePaper[]; onClose: () => void };
const amount = (value: number) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function printA4Document(root: HTMLElement, print: () => void): Promise<void> {
  await root.ownerDocument.fonts.ready;
  try {
    await Promise.all(Array.from(root.querySelectorAll("img")).map(async image => {
      if (!image.complete || image.naturalWidth === 0) await image.decode();
      if (image.naturalWidth === 0) throw new Error("图片尚未加载");
    }));
  } catch { throw new Error("有照片或收款二维码未能加载，请稍候重试打印"); }
  if (!root.isConnected) throw new Error("打印预览已关闭");
  print();
}

function PriceTable({ lines, heading = "费用明细" }: { lines: PaperLine[]; heading?: string }) {
  if (!lines.length) return null;
  return <section className="a4-fees"><h3>{heading}</h3><table><thead><tr><th scope="col">项目</th><th scope="col">金额 / 明细</th></tr></thead><tbody>{lines.map((line, index) => <tr className={line.divider ? "a4-row-divider" : ""} key={index}><td>{line.label}{line.detail && <small>{line.detail}</small>}</td><td>{line.value}</td></tr>)}</tbody></table></section>;
}

function Product({ product }: { product: PaperProduct }) {
  return <section className="a4-item"><div className="a4-item-heading"><img src={product.image} alt={product.title} /><div><h3>{product.title}</h3><p>{product.specs}</p><dl className="a4-item-parameters">{product.parameters.map(parameter => <div key={parameter.label}><dt>{parameter.label}</dt><dd>{parameter.value}</dd></div>)}</dl></div></div><PriceTable lines={product.lines} heading="商品明细" /><div className="a4-item-subtotal"><span>{product.totalLabel}</span><strong>{amount(product.total)} 元</strong></div></section>;
}

// Semantic text, original photographs and QR codes are laid out directly on A4.
// QuotePaper already applies customer visibility rules and historical snapshots.
export function A4Page({ paper }: { paper: QuotePaper }) {
  return <div className="a4-preview-page"><article className="a4-sheet" aria-label={`${paper.typeLabel} A4 第${paper.page}页`} data-quote-number={paper.number}>
    <header className="a4-brand"><div>{paper.brand.english || "XIN JIN YUAN"}</div><p>{paper.brand.name || "鑫金源"}</p></header>
    <div className="a4-meta"><span>客户：{paper.customerName}</span><span>日期：{paper.date}</span></div>
    <div className="a4-document-title"><h1>{paper.typeLabel}</h1><p>报价编号：{paper.number}</p></div>
    <div className="a4-content">
      {paper.products?.length ? <div className="a4-products">{paper.products.map(product => <Product key={product.id} product={product} />)}</div> : <>
        <section className="a4-main-product"><img src={paper.image} alt={paper.title} /><div><h2>{paper.title}</h2><p>{paper.specs}</p></div></section>
        {!!paper.parameters.length && <dl className="a4-parameters">{paper.parameters.map(parameter => <div key={parameter.label}><dt>{parameter.label}</dt><dd>{parameter.value}</dd></div>)}</dl>}
      </>}
      {!!paper.lines.length && <PriceTable lines={paper.lines} heading={paper.products?.length ? "整单明细" : "费用明细"} />}
      {paper.continuation && <section className="a4-continuation"><h3>{paper.continuationTitle || "补充说明"}</h3><p>{paper.continuation.join("\n")}</p></section>}
      {!!paper.payments?.length && <section className="a4-payments"><h3>收款方式</h3><div className="a4-payment-grid">{paper.payments.map(method => <section className="a4-payment" key={method.id}><div><h4>{method.name}</h4><p>{method.detailLines.join("\n")}</p></div>{method.image && <img className="a4-qr" src={method.image} alt={`${method.name}收款二维码`} />}</section>)}</div></section>}
    </div>
    <div className="a4-total"><span>{paper.totalLabel}</span><strong>{amount(paper.total)}<small>元</small></strong></div>
    {paper.note && <p className="a4-note">{paper.note}</p>}
    <footer className="a4-footer"><span>{paper.number}</span><span>{paper.brand.contact || paper.brand.name}</span><span>第 {paper.page} / {paper.pages} 页</span></footer>
  </article></div>;
}

export function A4Document({ papers }: { papers: QuotePaper[] }) {
  return <div className="a4-document">{papers.map((paper, index) => <A4Page key={`${paper.number}-${index}`} paper={paper} />)}</div>;
}

export default function A4Quotation({ papers, onClose }: A4QuotationProps) {
  const [mounted, setMounted] = useState(false);
  const [printing, setPrinting] = useState(false), [printError, setPrintError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const printButton = useRef<HTMLButtonElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const handlePrint = async () => {
    if (!root.current || printing) return;
    const target = root.current;
    setPrinting(true); setPrintError("");
    try { await printA4Document(target, () => window.print()); }
    catch (error) { if (target.isConnected) setPrintError(error instanceof Error ? error.message : "暂时无法准备打印，请重试"); }
    finally { if (target.isConnected) setPrinting(false); }
  };
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted) return;
    printButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab" && event.shiftKey && document.activeElement === printButton.current) { event.preventDefault(); closeButton.current?.focus(); }
      else if (event.key === "Tab" && !event.shiftKey && document.activeElement === closeButton.current) { event.preventDefault(); printButton.current?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mounted, onClose]);
  if (!mounted) return null;
  return createPortal(<div ref={root} className="a4-print-root" role="dialog" aria-modal="true" aria-labelledby="a4-preview-title">
    <header className="a4-toolbar"><div><h2 id="a4-preview-title">A4 报价单</h2><p>纵向打印 · 共 {papers.length} 页</p>{printError && <p className="a4-print-error" role="alert">{printError}</p>}</div><div className="a4-toolbar-actions"><button ref={printButton} disabled={printing} className="a4-toolbar-button a4-print-button" type="button" onClick={handlePrint}>{printing ? "正在准备打印…" : "打印 / 保存PDF"}</button><button ref={closeButton} className="a4-toolbar-button" type="button" onClick={onClose}>关闭返回</button></div></header>
    <div className="a4-preview-scroll"><A4Document papers={papers} /></div>
  </div>, document.body);
}
