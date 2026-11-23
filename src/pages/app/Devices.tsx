import { useEffect, useState } from "react";
import { useWorkspace } from "../../components/AppLayout";
import { useAuth } from "../../lib/AuthContext";
import { db } from "../../lib/supabase";
import { Notice, Empty } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { selfHosted } from "../../lib/localBackend";

type Device = {
  id: string;
  device_name: string;
  platform: string | null;
  last_seen_at: string;
  created_at: string;
  revoked_at: string | null;
};

export function DevicesPage() {
  const { workspace } = useWorkspace();
  const { session } = useAuth();
  const owner = workspace.owner_id === session?.user.id;
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const r = await db().rpc("list_devices", { p_workspace: workspace.id });
    if (r.error) setError(r.error.message);
    else setDevices(r.data ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, [workspace.id]);

  async function revoke(deviceId: string, revokeToken = false) {
    if (!window.confirm("Revoke this device? The CLI on that machine will lose access.")) return;
    setBusy(true);
    setError("");
    const r = await db().rpc("revoke_device", {
      p_workspace: workspace.id,
      p_device_id: deviceId,
      p_revoke_token: revokeToken,
    });
    if (r.error) setError(r.error.message);
    else { setNotice("Device revoked."); await load(); }
    setBusy(false);
  }

  function statusOf(d: Device) {
    if (d.revoked_at) return "revoked";
    const ago = Date.now() - new Date(d.last_seen_at).getTime();
    if (ago > 7 * 24 * 3600 * 1000) return "stale";
    return "active";
  }

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">YOUR MACHINES</span>
          <h1>Devices</h1>
          <p>CLI registrations and their last heartbeat. Revoke devices you no longer use.</p>
        </div>
        <button className="button secondary" disabled={loading} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error && <Notice error>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}

      {selfHosted && (
        <Notice>Devices require the Supabase backend. This feature is not available in self-hosted mode.</Notice>
      )}

      {loading ? (
        <p role="status">Loading devices…</p>
      ) : devices.length === 0 ? (
        <Empty title="No devices registered yet.">
          Run <code>continuum login</code> from the CLI to register this machine.
        </Empty>
      ) : (
        <section className="app-section">
          {devices.map((d) => {
            const status = statusOf(d);
            return (
              <div className="device-row" key={d.id}>
                <div className="device-info">
                  <strong>{d.device_name}</strong>
                  {d.platform && <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--color-muted,#888)" }}>{d.platform}</span>}
                  <small>
                    Registered {new Date(d.created_at).toLocaleString()} ·{" "}
                    Last seen {new Date(d.last_seen_at).toLocaleString()}
                    {d.revoked_at && ` · Revoked ${new Date(d.revoked_at).toLocaleString()}`}
                  </small>
                </div>
                <span className={`device-status ${status}`}>{status}</span>
                {owner && !d.revoked_at && (
                  <button
                    className="button danger"
                    disabled={busy}
                    onClick={() => void revoke(d.id, false)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
