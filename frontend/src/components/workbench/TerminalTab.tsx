import { useEffect, useRef, useState } from "react";
import { CircleStop, RotateCw, Send, Trash2 } from "lucide-react";
import { useStore } from "../../store";
import "./TerminalTab.css";

const MAX_OUTPUT = 200_000;

export function TerminalTab({ visible }: { visible: boolean }) {
  const project = useStore((s) => s.agentProjectId) || "default";
  const zh = useStore((s) => s.uiLang) === "zh";
  const [generation, setGeneration] = useState(0);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState("connecting");
  const [output, setOutput] = useState("");
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [shell, setShell] = useState("");
  const [pty, setPty] = useState(false);
  const [interruptCloses, setInterruptCloses] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const display = useRef<HTMLPreElement>(null);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(0);
  useEffect(() => { if (visible) setStarted(true); }, [visible]);
  useEffect(() => {
    if (!started) return;
    setOutput(""); setStatus("connecting"); setCwd(""); setShell(""); setPty(false); setCommand("");
    history.current = []; historyIndex.current = 0;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/api/workspace/${encodeURIComponent(project)}/terminal`);
    socket.current = ws;
    ws.onmessage = (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === "ready") {
        setStatus("ready"); setCwd(message.cwd); setShell(message.shell); setPty(!!message.pty);
        setInterruptCloses(message.interrupt_mode === "close");
      } else if (message.type === "output") {
        const text = String(message.data || "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
        setOutput((previous) => (previous + text).slice(-MAX_OUTPUT));
      } else if (message.type === "error") {
        setStatus("error"); setOutput((previous) => `${previous}\n${message.message}\n`);
      } else if (message.type === "exit") {
        setStatus("closed"); setOutput((previous) => `${previous}\n${zh ? "终端已退出" : "Shell exited"} (${message.code ?? "—"})\n`);
      }
    };
    ws.onerror = () => {
      setStatus("error");
      setOutput((previous) => `${previous}\n${zh ? "终端连接失败，请确认后端已更新并重试。" : "Terminal connection failed. Check the backend and retry."}\n`);
    };
    ws.onclose = () => setStatus((previous) => previous === "error" ? previous : "closed");
    return () => {
      ws.onmessage = null; ws.onerror = null; ws.onclose = null;
      ws.close();
      if (socket.current === ws) socket.current = null;
    };
  }, [project, generation, started]);
  useEffect(() => { if (display.current && visible) display.current.scrollTop = display.current.scrollHeight; }, [output, visible]);
  const send = (message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  };
  return <section className="gx-terminal" hidden={!visible}>
    <div className="gx-terminal-head">
      <span className={`gx-terminal-status ${status}`}>{status === "ready" ? (zh ? "已连接" : "Connected") : status === "connecting" ? (zh ? "连接中…" : "Connecting…") : status === "error" ? (zh ? "连接失败" : "Connection failed") : (zh ? "已断开" : "Disconnected")}</span>
      <code title={`${zh ? "启动目录" : "Starting directory"}: ${cwd}`}>{cwd || (zh ? "当前工作区" : "Current workspace")}</code>
      {shell && <small>{shell.split(/[\\/]/).pop()}</small>}
      <button type="button" title={interruptCloses ? (zh ? "结束终端及其命令" : "Stop terminal and its commands") : (zh ? "中断命令" : "Interrupt command")} disabled={status !== "ready"} onClick={() => send({ type: "interrupt" })}><CircleStop size={14} /></button>
      <button type="button" title={zh ? "清空显示" : "Clear display"} onClick={() => setOutput("")}><Trash2 size={14} /></button>
      <button type="button" title={zh ? "重新连接" : "Reconnect"} onClick={() => setGeneration((n) => n + 1)}><RotateCw size={14} /></button>
    </div>
    <pre className="gx-terminal-output" ref={display} tabIndex={0} aria-label={zh ? "终端输出" : "Terminal output"}>{output || (zh ? "输入命令，在当前论文工作区运行。" : "Enter a command to run in the current workspace.")}</pre>
    <form onSubmit={(event) => {
      event.preventDefault(); if (!command.trim() || status !== "ready") return;
      if (!pty) setOutput((previous) => `${previous}\n> ${command}\n`);
      history.current = [...history.current.slice(-99), command]; historyIndex.current = history.current.length;
      send({ type: "input", data: command + "\n" }); setCommand("");
    }}>
      <span aria-hidden="true">›</span>
      <input aria-label={zh ? "终端命令" : "Terminal command"} placeholder={zh ? "输入命令，Enter 执行" : "Enter a command, press Enter to run"} value={command} disabled={status !== "ready"} onChange={(e) => setCommand(e.target.value)} onKeyDown={(event) => {
        if (event.ctrlKey && event.key.toLowerCase() === "c" && !command) { event.preventDefault(); send({ type: "interrupt" }); }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault(); historyIndex.current = Math.max(0, Math.min(history.current.length, historyIndex.current + (event.key === "ArrowUp" ? -1 : 1)));
          setCommand(history.current[historyIndex.current] || "");
        }
      }} />
      <button type="submit" disabled={status !== "ready" || !command.trim()} title={zh ? "执行命令" : "Run command"}><Send size={14} /></button>
    </form>
  </section>;
}
