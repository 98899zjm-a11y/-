import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { A4Document } from "@/components/a4-quotation";
import QuoteCard, { createQuotePages, type QuoteDraft } from "@/components/quote-card";
import { defaultSettings } from "@/lib/domain";
import { createQuoteImage } from "@/lib/quote-image";
import "@/app/globals.css";
import { testPaymentCode } from "./payment-code";

declare global {
  interface Window {
    __xjyA4FixtureReady: boolean;
    __xjyA4FixtureError?: string;
    __xjyA4FixturePageCount: number;
    __xjyNativeFixture: { ready: boolean; pages: number; png?: string; error?: string; layoutIssues?: string[] };
  }
}

const fixture: QuoteDraft = {
  type: "sale", customerId: "native-print-test", title: "两件珠宝销售报价", material: "Pt950铂金", specs: "仅用于本机打印验收", image: "/print-test/ring.jpg", images: [],
  weight: 0, goldPrice: 450, laborPrice: 80, extras: [], discountType: "amount", discountValue: 200,
  recyclingCoefficient: .99, repairItems: [], insured: false, insuredValue: 0, insuranceRate: 6,
  note: "本机原生A4验收样例，仅为测试数据。",
  saleItems: [
    { id: "fixture-ring", title: "铂金培育钻石戒指", material: "Pt950铂金", specs: "培育钻石1.00ct · 戒圈13号", image: "/print-test/ring.jpg", weight: 3.2, goldPrice: 450, laborPrice: 80, extras: [{ id: "fixture-stone", name: "培育钻石", amount: 900 }], quantity: 1 },
    { id: "fixture-pendant", title: "黄金定制吊坠", material: "足金", specs: "定制吊坠 · 刻字已确认", image: "/print-test/ring.jpg", weight: 2.1, goldPrice: 450, laborPrice: 80, extras: [{ id: "fixture-accessory", name: "配件", amount: 120 }], quantity: 1 },
  ],
  paymentMethods: [
    { id: "fixture-wechat", name: "微信收款", details: "收款人：测试工作室", image: testPaymentCode },
    { id: "fixture-alipay", name: "支付宝收款", details: "收款人：测试工作室", image: testPaymentCode },
  ],
};
const fixtureCase = new URLSearchParams(window.location.search).get("case");
if (fixtureCase === "8") { fixture.saleItems=fixture.saleItems!.slice(0,1);fixture.paymentMethods=Array.from({length:8},(_,i)=>({id:`p${i}`,name:`收款方式${i+1}`,details:`测试账户${i+1}`,image:testPaymentCode})); }
if (fixtureCase === "trade") { fixture.type="tradein"; fixture.material="黄金";fixture.tradeInItems=fixture.saleItems!.map(item=>({...item,material:"黄金"})); fixture.saleItems=[];fixture.tradeIn={mode:"gram",oldMaterial:"gold",oldWeight:4,depreciationPrice:20,excessMode:"recycle",excessGoldPrice:450,excessCoefficient:.99}; }
const papers = createQuotePages(fixture, defaultSettings, { customerName: "打印验收客户", number: "S20261010-PRINT-TEST", date: "2026-10-10" });
window.__xjyA4FixtureReady = false;
window.__xjyA4FixturePageCount = papers.length;
window.__xjyNativeFixture = { ready: false, pages: papers.length };

function Fixture() {
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll<HTMLImageElement>(".a4-print-root img")].map(async image => { await image.decode(); if (!image.naturalWidth) throw new Error("本机商品图片没有加载"); }));
        const png = await createQuoteImage(papers[0]);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const issues:string[]=[];
        const card=document.querySelector<HTMLElement>(".native-quote-proof .qp-paper");
        if (card) {
          const paper=card.getBoundingClientRect(),total=card.querySelector(".paper-total")!.getBoundingClientRect();
          for(const element of card.querySelectorAll(".qp-attached-product,.qp-attached-summary>div,.qp-attached-payment")){const rect=element.getBoundingClientRect();if(rect.bottom>total.top+1)issues.push(`${element.className}碰到总价区域`);if(rect.left<paper.left-1||rect.right>paper.right+1)issues.push(`${element.className}横向超框`);}
          for(const row of card.querySelectorAll(".qp-attached-fees>div")){const label=row.querySelector("dt")!.getBoundingClientRect(),amount=row.querySelector("dd")!.getBoundingClientRect();if(label.right>amount.left-1)issues.push("商品费用名称与金额相碰");}
          for(const payment of card.querySelectorAll(".qp-attached-payment")){const image=payment.querySelector("img"),info=payment.querySelector("p");if(image&&info&&info.getBoundingClientRect().bottom>image.getBoundingClientRect().top+1)issues.push("收款说明与二维码相碰");}
        }
        if(issues.length)throw new Error(issues.join("；"));
        if (active) { window.__xjyA4FixtureReady = true; window.__xjyNativeFixture = { ready: true, pages: papers.length, png, layoutIssues:issues }; document.documentElement.dataset.fixtureReady = "true"; }
      } catch (error) { const message = error instanceof Error ? error.message : "打印验收页加载失败"; window.__xjyA4FixtureError = message; window.__xjyNativeFixture = { ready: false, pages: papers.length, error: message }; }
    })();
    return () => { active = false; };
  }, []);
  // Production A4 uses a body portal. Keep the same direct-body structure so
  // its print-only rules and pagination are exercised by native printToPDF.
  return <><div className="native-quote-proof" style={{position:"fixed",left:-10000,top:0,width:360}}><QuoteCard paper={papers[0]}/></div>{createPortal(<div className="a4-print-root"><div className="a4-preview-scroll"><A4Document papers={papers} /></div></div>, document.body)}</>;
}

createRoot(document.getElementById("fixture-root")!).render(<Fixture />);
