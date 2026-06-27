import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebLLM × MCP × Cedar — 認可デモ",
  description:
    "ブラウザ内 LLM (WebLLM) エージェントが OAuth 保護された MCP サーバを呼び、Cedar がロールで動的認可する学習用デモ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
