import { notFound } from "next/navigation";
import { getChatGPTUser, chatGPTSignInPath } from "../chatgpt-auth";
import Workspace from "../workspace";
import { bootstrap } from "../../lib/server";

export const dynamic = "force-dynamic";
const pages = ["sales", "recycling", "repairs", "customers", "history", "settings"] as const;
type Page = (typeof pages)[number];

export default async function Page({ params }: { params: Promise<{section:string}> }) {
  const { section } = await params;
  if (!pages.includes(section as Page)) notFound();
  const identity = await getChatGPTUser();
  if (!identity) return <main className="welcome"><div className="welcome-brand">XIN JIN YUAN</div><span className="eyebrow">JEWELRY ATELIER</span><h1>每一份报价，<br/>都值得精心呈现。</h1><p>销售 · 回收 · 维修</p><a className="button primary" target="_top" href={chatGPTSignInPath(`/${section}`)}>登录报价工作室</a><small>管理员管理默认价格与员工权限。</small></main>;
  try {
    const initial = await bootstrap();
    return <Workspace initial={initial} initialPage={section as Page} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : "暂时无法进入工作室";
    return <main className="welcome"><div className="welcome-brand">XIN JIN YUAN</div><h1>暂时无法进入</h1><p>{message}</p><p>请联系管理员确认账号权限。</p><a className="button" href="/signout-with-chatgpt?return_to=/" target="_top">退出账号</a></main>;
  }
}
