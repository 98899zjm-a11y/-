import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "鑫金源 · 珠宝报价工作室",
  description: "销售、回收与维修报价，客户档案及报价历史。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
