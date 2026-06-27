// AS authorization endpoint UI (spec §8.1). Renders the anonymous "pick a user"
// login with three fictional users. Each choice POSTs the OAuth request params
// (plus the chosen user) to /api/authorize, which mints a code and redirects
// back to the SPA.

import { USERS } from "@/lib/config";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const params = {
    response_type: one(sp.response_type),
    client_id: one(sp.client_id),
    redirect_uri: one(sp.redirect_uri),
    code_challenge: one(sp.code_challenge),
    code_challenge_method: one(sp.code_challenge_method),
    resource: one(sp.resource),
    scope: one(sp.scope),
    state: one(sp.state),
  };

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <h1>Minimal AS — ログイン</h1>
        <p className="muted">
          匿名ログイン（PIIなし）。ロール入りのアクセストークンを発行します。利用者を選んでください。
        </p>

        <dl className="req">
          <dt>client_id</dt>
          <dd>{params.client_id || "—"}</dd>
          <dt>scope</dt>
          <dd>{params.scope || "—"}</dd>
          <dt>resource (aud)</dt>
          <dd className="break">{params.resource || "—"}</dd>
          <dt>redirect_uri</dt>
          <dd className="break">{params.redirect_uri || "—"}</dd>
          <dt>PKCE</dt>
          <dd>{params.code_challenge_method || "—"}</dd>
        </dl>

        <div className="users">
          {Object.values(USERS).map((u) => (
            <form key={u.sub} method="POST" action="/api/authorize">
              <input type="hidden" name="user" value={u.sub} />
              <input type="hidden" name="response_type" value={params.response_type} />
              <input type="hidden" name="client_id" value={params.client_id} />
              <input type="hidden" name="redirect_uri" value={params.redirect_uri} />
              <input type="hidden" name="code_challenge" value={params.code_challenge} />
              <input type="hidden" name="code_challenge_method" value={params.code_challenge_method} />
              <input type="hidden" name="resource" value={params.resource} />
              <input type="hidden" name="scope" value={params.scope} />
              <input type="hidden" name="state" value={params.state} />
              <button type="submit" className={`user-btn role-${u.role}`}>
                <span className="user-name">{u.label}</span>
                <span className="user-role">{u.role}</span>
                <span className="user-desc">{u.description}</span>
              </button>
            </form>
          ))}
        </div>
      </div>
    </main>
  );
}
