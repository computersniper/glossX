import { useEffect, useMemo, useState } from "react";
import qrcode from "qrcode-generator";
import { isMobileClient, leaveComputer } from "../mobile";

type RemoteStatus = {
  enabled: boolean;
  reachable: boolean;
  restart_required: boolean;
  auth: boolean;
  port: number;
  token: string;
  urls: string[];
};

function pairLink(url: string, token: string) {
  return `glossx://pair?${new URLSearchParams({ u: url, t: token })}`;
}

function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  // black on white whatever the theme: phone cameras need the contrast
  return <div className="mobile-qr" role="img" aria-label="QR code" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * Settings → Mobile access. On the computer: turn it on and show the address,
 * pairing code and a QR code for the phone/tablet app. In the app itself: which
 * computer this is, and a way back to the computer list.
 */
export function MobileAccess({ zh }: { zh: boolean }) {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const remote = isMobileClient();

  useEffect(() => {
    if (remote) return;
    fetch("/api/remote")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [remote]);

  const change = async (patch: { enabled?: boolean; rotate_token?: boolean }) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/remote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error(String(r.status));
      setStatus(await r.json());
    } catch {
      setError(zh ? "保存失败" : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };

  if (remote) {
    return (
      <section className="usage-card" aria-label={zh ? "移动端" : "Mobile"}>
        <div className="usage-head">
          <div>
            <strong>{zh ? "已连接的电脑" : "Connected computer"}</strong>
            <span>{window.location.host}</span>
          </div>
          <button className="small" type="button" onClick={() => leaveComputer()}>{zh ? "切换电脑" : "Switch computer"}</button>
        </div>
        <p className="usage-note">{zh ? "论文、对话和 Claude Code / Codex 都在这台电脑上运行，手机和平板只是遥控。" : "Papers, threads and Claude Code / Codex all run on this computer; this device drives them remotely."}</p>
      </section>
    );
  }
  // older backend, or opened from another device without the app
  if (!status) return null;

  const url = status.urls[0];
  return (
    <section className="usage-card mobile-access" aria-label={zh ? "移动端访问" : "Mobile access"}>
      <div className="usage-head">
        <div>
          <strong>{zh ? "移动端访问" : "Mobile access"}</strong>
          <span>{zh ? "用 iPhone、iPad 或 Android 上的 GlossX 连接这台电脑" : "Use GlossX on iPhone, iPad or Android with this computer"}</span>
        </div>
        <label className="mobile-switch">
          <input type="checkbox" checked={status.enabled} disabled={busy} onChange={(e) => void change({ enabled: e.target.checked })} />
          <span>{zh ? "允许" : "Allow"}</span>
        </label>
      </div>
      {status.restart_required && (
        <p className="usage-note" role="alert">{zh ? "重启 GlossX 后生效（会固定在端口 " : "Restart GlossX to apply (it will listen on port "}{status.port}{zh ? "）。" : ")."}</p>
      )}
      {status.reachable && (
        <>
          {!status.auth && <p className="usage-note" role="alert">{zh ? "GLOSS_REMOTE_AUTH=off：局域网内任何设备都能直接访问。" : "GLOSS_REMOTE_AUTH=off: any device on the network can connect without a code."}</p>}
          {url ? (
            <div className="mobile-pair">
              <QrCode text={pairLink(url, status.token)} />
              <div className="mobile-pair-text">
                <p className="usage-note">{zh ? "用手机相机扫码打开 GlossX，或在 App 里填写：" : "Scan with the phone's camera to open GlossX, or enter in the app:"}</p>
                <label>{zh ? "地址" : "Address"}</label>
                {status.urls.map((u) => <code key={u}>{u.replace(/^http:\/\//, "")}</code>)}
                <label>{zh ? "配对码" : "Pairing code"}</label>
                <code className="mobile-code">{status.token}</code>
                <button className="small" type="button" disabled={busy} onClick={() => void change({ rotate_token: true })}>
                  {zh ? "换一个配对码" : "New pairing code"}
                </button>
              </div>
            </div>
          ) : (
            <p className="usage-note">{zh ? "没找到局域网地址，请确认电脑已联网。" : "No network address found; check that this computer is online."}</p>
          )}
          <p className="usage-note">{zh ? "手机和电脑要在同一个 Wi‑Fi，或同一个 VPN（如 Tailscale）。换配对码后，已连接的设备需要重新输入。" : "The phone and this computer need the same Wi-Fi or VPN (e.g. Tailscale). A new code signs out every connected device."}</p>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
