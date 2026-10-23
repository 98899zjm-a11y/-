import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { A4Document, printA4Document } from '../../components/a4-quotation';
import { createQuotePages } from '../../components/quote-card';
import { defaultSettings, type QuoteRecord } from '../../lib/domain';
import WarrantyDocument, { prepareWarrantyDocument } from './warranty-document';
import type { WarrantySheet } from './warranty-data';
import type { PrinterSettings } from './bridge';
import './print-window.css';
type PrintDocument = { kind: 'quotation-a4' | 'warranty'; quote: QuoteRecord; date: string; settings: PrinterSettings; sheets?: WarrantySheet[] };
declare global { interface Window { jewelryPrint: { load(): Promise<PrintDocument>; ready(): Promise<boolean>; error(message: string): Promise<boolean> } } }
function PrintOutput({ document }: { document: PrintDocument }) {
  const root = useRef<HTMLDivElement>(null);
  const warranty = document.kind === 'warranty';
  const snapshot = document.quote.snapshot || document.quote.data;
  const papers = warranty ? [] : createQuotePages(snapshot, { ...defaultSettings, brand: snapshot.brand }, { customerName: snapshot.customer.name, number: document.quote.number, date: document.date });
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!root.current) throw new Error('打印文档尚未生成');
      if (warranty) await prepareWarrantyDocument(root.current);
      else await printA4Document(root.current, () => {});
      if (alive) await window.jewelryPrint.ready();
    })().catch(error => { if (alive) void window.jewelryPrint.error(error instanceof Error ? error.message : '打印文档尚未准备'); });
    return () => { alive = false; };
  }, [document, warranty]);
  return createPortal(<div ref={root} className={warranty ? 'warranty-print-root' : 'a4-print-root'}>
    {warranty ? <><style>{`@media print{@page{size:${document.settings.widthMm}mm ${document.settings.heightMm}mm;margin:0}}`}</style><div className="warranty-preview-scroll">{document.sheets?.map(sheet => <WarrantyDocument key={sheet.id} data={sheet.data} {...document.settings}/>)}</div></> : <div className="a4-preview-scroll"><A4Document papers={papers}/></div>}
  </div>, window.document.body);
}
void window.jewelryPrint.load().then(document => createRoot(window.document.getElementById('root')!).render(<PrintOutput document={document}/>)).catch(error => void window.jewelryPrint.error(error instanceof Error ? error.message : '打印信息未能读取'));
