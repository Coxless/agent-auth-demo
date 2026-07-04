"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginLogin,
  completeLoginIfCallback,
  decodeJwt,
  discover,
  type LogStatus,
} from "@/lib/client/oauth";
import { McpClient, callToolLogged, type McpTool } from "@/lib/client/mcp-client";
import { DEFAULT_MODEL, loadEngine, runAgent, type AgentEvent, type LoadedEngine } from "@/lib/client/agent";

interface LogEntry {
  step: string;
  status: LogStatus;
  detail?: unknown;
  time: string;
}

interface ChatMsg {
  who: "user" | "assistant" | "tool";
  text: string;
}

const TOKEN_KEY = "access_token";
const LOG_KEY = "oauth_flow_log";

function loadPersistedLog(): LogEntry[] {
  try {
    const raw = sessionStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch {
    return [];
  }
}

export default function Home() {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const clientRef = useRef<McpClient | null>(null);

  const [recordId, setRecordId] = useState("r1");
  const [writeData, setWriteData] = useState('{"title":"updated","note":"from manual UI"}');

  // WebLLM state
  const [engine, setEngine] = useState<LoadedEngine | null>(null);
  const [modelStatus, setModelStatus] = useState<string>("");
  const [modelLoading, setModelLoading] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("r1 を読んで内容を教えて");
  const [agentBusy, setAgentBusy] = useState(false);
  const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;

  const addLog = useCallback((step: string, status: LogStatus, detail?: unknown) => {
    setLog((prev) => {
      const next = [...prev, { step, status, detail, time: new Date().toLocaleTimeString() }];
      sessionStorage.setItem(LOG_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const mcpUrl = () => window.location.origin + "/mcp";

  // --- token lifecycle ---
  const applyToken = useCallback(
    async (tok: string) => {
      setToken(tok);
      sessionStorage.setItem(TOKEN_KEY, tok);
      setClaims(decodeJwt(tok));
      const client = new McpClient(mcpUrl(), tok);
      clientRef.current = client;
      try {
        addLog("6. MCP initialize (Bearer 付き)", "info");
        await client.initialize();
        const list = await client.listTools();
        setTools(list);
        addLog("   → initialize / tools/list 成功", "ok", list.map((t) => t.name));
      } catch (e) {
        addLog("MCP 初期化に失敗", "err", String(e));
      }
    },
    [addLog],
  );

  useEffect(() => {
    setLog(loadPersistedLog());
    (async () => {
      const result = await completeLoginIfCallback(addLog);
      if (result) {
        await applyToken(result.access_token);
        return;
      }
      const existing = sessionStorage.getItem(TOKEN_KEY);
      if (existing) {
        const c = decodeJwt(existing);
        const exp = typeof c?.exp === "number" ? (c.exp as number) : 0;
        if (exp * 1000 > Date.now()) {
          await applyToken(existing);
        } else {
          sessionStorage.removeItem(TOKEN_KEY);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async () => {
    try {
      setLog([]);
      sessionStorage.removeItem(LOG_KEY);
      const disc = await discover(mcpUrl(), addLog);
      await beginLogin(disc, addLog);
    } catch (e) {
      addLog("ディスカバリ/ログイン開始に失敗", "err", String(e));
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setClaims(null);
    setTools([]);
    clientRef.current = null;
    addLog("ログアウト（トークン破棄）", "info");
  };

  const runTool = async (name: string, args: Record<string, unknown>) => {
    const client = clientRef.current;
    if (!client) return;
    try {
      await callToolLogged(client, name, args, addLog);
    } catch {
      /* logged already */
    }
  };

  const loadModel = async () => {
    setModelLoading(true);
    setModelStatus("モデルを準備中…");
    try {
      const loaded = await loadEngine(DEFAULT_MODEL, (text, p) =>
        setModelStatus(`${text} (${Math.round(p * 100)}%)`),
      );
      setEngine(loaded);
      setModelStatus(`ロード完了: ${loaded.model}`);
    } catch (e) {
      setModelStatus(`モデル読み込み失敗: ${String(e)}`);
    } finally {
      setModelLoading(false);
    }
  };

  const sendChat = async () => {
    const client = clientRef.current;
    if (!client || !engine || !chatInput.trim()) return;
    const userText = chatInput.trim();
    setChat((c) => [...c, { who: "user", text: userText }]);
    setChatInput("");
    setAgentBusy(true);
    const emit = (e: AgentEvent) => {
      if (e.type === "assistant") setChat((c) => [...c, { who: "assistant", text: e.text }]);
      else if (e.type === "tool")
        setChat((c) => [
          ...c,
          { who: "tool", text: `${e.name}(${JSON.stringify(e.args)}) → ${e.isError ? "⛔ " : "✅ "}${e.result}` },
        ]);
      else setModelStatus(e.text);
    };
    try {
      await runAgent(engine, userText, tools, client, emit);
    } catch (e) {
      setChat((c) => [...c, { who: "assistant", text: `エラー: ${String(e)}` }]);
    } finally {
      setAgentBusy(false);
    }
  };

  const role = (claims?.role as string) || "";

  return (
    <div className="app">
      <h1>WebLLM × MCP リソースサーバ × Cedar 動的認可</h1>
      <p className="sub">
        ブラウザ内 LLM がエージェントとして OAuth 保護された MCP サーバを呼び、サーバ内 Cedar がロールで動的に認可する学習デモ。
      </p>

      {/* status bar */}
      <div className="statusbar">
        {token ? (
          <>
            <span className="identity">
              <span className={`badge role-${role}`}>
                {String(claims?.sub)} · {role}
              </span>
            </span>
            <span className="pill">scope: {String(claims?.scope)}</span>
            <span className="pill">aud: {String(claims?.aud)}</span>
            <button onClick={handleLogout}>ログアウト</button>
          </>
        ) : (
          <button className="primary" onClick={handleLogin}>
            ログイン（ディスカバリ → PKCE）
          </button>
        )}
      </div>

      <div className="grid">
        {/* Left: flow log */}
        <div>
          <div className="panel">
            <h2>OAuth / MCP フローログ</h2>
            <div className="flowlog">
              {log.length === 0 && <p className="muted">「ログイン」を押すと 401 → PRM → AS メタデータ → PKCE → token → MCP の流れが表示されます。</p>}
              {log.map((e, i) => (
                <div key={i} className={`logentry ${e.status}`}>
                  <div className="lhead">
                    <span className="lstep">{e.step}</span>
                    <span className="ltime">{e.time}</span>
                  </div>
                  {e.detail !== undefined && (
                    <pre>{typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail, null, 2)}</pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: tools + agent */}
        <div>
          <div className="panel">
            <h2>手動ツール実行（フォールバック）</h2>
            {!token && <p className="muted">先にログインしてください。</p>}
            {token && (
              <div className="toolgrid">
                <div className="row">
                  <label>record id</label>
                  <input style={{ width: 120 }} value={recordId} onChange={(e) => setRecordId(e.target.value)} />
                </div>
                <div className="row">
                  <button onClick={() => runTool("readRecord", { id: recordId })}>readRecord</button>
                  <button
                    onClick={() => {
                      let data: unknown = {};
                      try {
                        data = JSON.parse(writeData);
                      } catch {
                        data = { raw: writeData };
                      }
                      runTool("writeRecord", { id: recordId, data });
                    }}
                  >
                    writeRecord
                  </button>
                  <button className="danger" onClick={() => runTool("deleteRecord", { id: recordId })}>
                    deleteRecord
                  </button>
                </div>
                <div>
                  <label>writeRecord data (JSON)</label>
                  <textarea rows={2} value={writeData} onChange={(e) => setWriteData(e.target.value)} />
                </div>
                <table className="matrix">
                  <thead>
                    <tr>
                      <th>role</th>
                      <th>read</th>
                      <th>write</th>
                      <th>delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td className="role">admin</td><td>✅</td><td>✅</td><td>✅</td></tr>
                    <tr><td className="role">editor</td><td>✅</td><td>✅</td><td>❌</td></tr>
                    <tr><td className="role">viewer</td><td>✅</td><td>❌</td><td>❌</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>WebLLM エージェント</h2>
            {!hasWebGPU && (
              <p className="muted">
                ⚠ この環境では WebGPU が利用できません。エージェントは動かせませんが、上の手動ツールで認可フローは体験できます。
              </p>
            )}
            <div className="row" style={{ marginBottom: 8 }}>
              <button onClick={loadModel} disabled={!hasWebGPU || modelLoading || !!engine}>
                {engine ? "モデル読込済み" : modelLoading ? "読み込み中…" : "モデルをロード"}
              </button>
              <span className="muted">{modelStatus}</span>
            </div>
            {engine && token && (
              <div className="chat">
                <div className="messages">
                  {chat.map((m, i) => (
                    <div key={i} className={`msg ${m.who}`}>
                      <div className="who">{m.who}</div>
                      <pre>{m.text}</pre>
                    </div>
                  ))}
                </div>
                <div className="row">
                  <input
                    style={{ flex: 1 }}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !agentBusy && sendChat()}
                    placeholder="例: r1 を読んで / r2 を削除して"
                  />
                  <button className="primary" onClick={sendChat} disabled={agentBusy}>
                    送信
                  </button>
                </div>
              </div>
            )}
            {engine && !token && <p className="muted">ログインするとエージェントが MCP を呼べます。</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
