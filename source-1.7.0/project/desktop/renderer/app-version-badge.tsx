import { useEffect, useState } from "react";
import "./app-version-badge.css";

export default function AppVersionBadge() {
  const [version, setVersion] = useState<string | null>(null);
  const browser = window.jewelryDesktop?.surface === "browser";
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => window.jewelryDesktop?.getAppInfo?.()).then(info => {
      const value = info?.appVersion;
      if (alive && typeof value === "string" && value.length <= 64 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) setVersion(value);
    }).catch(() => { /* Version metadata is optional; business screens stay available. */ });
    return () => { alive = false; };
  }, []);
  return <footer className="app-version-footer" aria-label="软件总版本"><span>{version ? `${browser ? "主机总版本" : "总版本"} v${version}` : "版本信息暂不可用"}</span></footer>;
}
