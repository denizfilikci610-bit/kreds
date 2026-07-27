// Sends a push to all of a user's registered devices - APNs (iPhone) or FCM (Android),
// valgt per raekke ud fra device_tokens.platform. Called by DB triggers (via pg_net).
// Auth: the trigger passes x-push-secret = app_hidden.push_hook.secret; checked via RPC.
// app_hidden is NOT exposed to PostgREST, so all reads/writes go through SECURITY DEFINER RPCs.
// Required secrets APNs: APNS_KEY (.p8), APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID.
// APNS_HOST er VALGFRI override - default er PRODUKTION (App Store/TestFlight-builds).
// Required secret FCM: FCM_SERVICE_ACCOUNT (hele service-account-JSON'en fra Firebase).
// Mangler den, faar Android-enheder ingen push men beholder kvarters-pollen.
import { createClient } from "npm:@supabase/supabase-js@2";

// Notifikations-skabeloner paa alle 32 UI-sprog. Ren DATA (strings med {n}=navn, {k}=kreds),
// ikke kode - saa en oversaettelse aldrig kan bryde funktionen. r.push_lang er brugerens
// VALGTE sprog; ukendt kode -> engelsk, manglende (legacy) -> dansk. Pr. noegle falder en
// manglende streng ogsaa tilbage til engelsk.
const FALLBACK: Record<string, Record<string, string>> = {"da": {"a_friend": "En ven", "a_kreds": "en kreds", "admitted": "Du er blevet optaget i “{k}” 🎉", "chat_dm": "{n} sendte dig en besked", "chat_kreds": "{n} skrev i “{k}”", "comment": "{n} svarede på dit opslag", "comment_like": "{n} likede din kommentar", "friend_now": "{n} blev din ven", "friend_request": "{n} sendte dig en venneanmodning", "invite": "{n} har inviteret dig til “{k}”", "kreq": "{n} vil gerne være med i “{k}”", "like": "{n} likede dit opslag", "mention": "{n} nævnte dig", "post": "{n} delte et opslag", "post_kreds": "{n} delte et opslag i “{k}”", "rejected": "Din optagelse i “{k}” blev ikke vedtaget", "reply": "{n} svarede på din kommentar", "someone": "Nogen", "the_kreds": "kredsen"}, "en": {"a_friend": "A friend", "a_kreds": "a kreds", "admitted": "You’ve been admitted to “{k}” 🎉", "chat_dm": "{n} sent you a message", "chat_kreds": "{n} wrote in “{k}”", "comment": "{n} replied to your post", "comment_like": "{n} liked your comment", "friend_now": "{n} is now your friend", "friend_request": "{n} sent you a friend request", "invite": "{n} invited you to “{k}”", "kreq": "{n} wants to join “{k}”", "like": "{n} liked your post", "mention": "{n} mentioned you", "post": "{n} shared a post", "post_kreds": "{n} shared a post in “{k}”", "rejected": "Your admission to “{k}” wasn’t approved", "reply": "{n} replied to your comment", "someone": "Someone", "the_kreds": "the kreds"}};
// De oevrige 30 sprog hentes fra den git-styrede fil paa vibefeed.dk (cached pr. cold-start).
// Fejler hentningen, bruges FALLBACK (da/en), saa push/poll ALDRIG gaar i staa.
let TG: Record<string, Record<string, string>> = FALLBACK;
let tgLoaded = false;
async function loadT(): Promise<void> {
  if (tgLoaded) return;
  try {
    const res = await fetch("https://vibefeed.dk/js/notif-i18n.json");
    if (res.ok) { const j = await res.json(); if (j && j.da && j.en) { TG = j; tgLoaded = true; } }
  } catch (_) { /* behold FALLBACK */ }
}
function tmpl(lang: string, key: string): string {
  const d = TG[lang] || TG.en;
  return d[key] ?? TG.en[key] ?? "";
}
function fill(s: string, n?: string, k?: string): string {
  return s.replace(/\{n\}/g, n ?? "").replace(/\{k\}/g, k ?? "");
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlStr(str: string): string { return b64url(new TextEncoder().encode(str)); }

let cachedJwt: { token: string; at: number } | null = null;
async function apnsJwt(): Promise<string> {
  if (cachedJwt && Date.now() - cachedJwt.at < 50 * 60 * 1000) return cachedJwt.token;
  const keyId = Deno.env.get("APNS_KEY_ID")!;
  const teamId = Deno.env.get("APNS_TEAM_ID")!;
  const pem = Deno.env.get("APNS_KEY")!;
  const header = b64urlStr(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = b64urlStr(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const data = `${header}.${payload}`;
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(data));
  const token = `${data}.${b64url(new Uint8Array(sig))}`;
  cachedJwt = { token, at: Date.now() };
  return token;
}

// ---- FCM (Android). OAuth2-token fra en RS256-signeret service-account-JWT, cached ~50 min.
let cachedFcm: { token: string; at: number } | null = null;
function fcmAccount(): { project_id: string; client_email: string; private_key: string } | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (j.project_id && j.client_email && j.private_key) return j;
  } catch (_) { /* falder til null */ }
  return null;
}
async function fcmAccessToken(): Promise<string | null> {
  if (cachedFcm && Date.now() - cachedFcm.at < 50 * 60 * 1000) return cachedFcm.token;
  const acc = fcmAccount();
  if (!acc) return null;
  const iat = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(JSON.stringify({
    iss: acc.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  }));
  const data = `${header}.${payload}`;
  const b64 = acc.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data));
  const jwt = `${data}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!res.ok) { console.error("fcm_oauth", res.status, (await res.text()).slice(0, 200)); return null; }
  const j = await res.json();
  if (!j.access_token) return null;
  cachedFcm = { token: j.access_token, at: Date.now() };
  return j.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
  await loadT();
  const pub = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: hookOk, error: hookErr } = await pub.rpc("check_push_hook", { sec: req.headers.get("x-push-secret") ?? "" });
  if (hookErr) { console.error("hook", hookErr); return new Response("error", { status: 500 }); }
  if (hookOk !== true) return new Response("forbidden", { status: 403 });

  let body: { user_id?: string; kind?: string; actor?: string; kreds?: string; pid?: number | string | null; fid?: string | null; cid?: number | string | null; msg?: string | null };
  try { body = await req.json(); } catch { return new Response("bad_request", { status: 400 }); }
  const userId = String(body.user_id ?? "");
  const kind = String(body.kind ?? "");
  if (!userId || !kind) return new Response("bad_request", { status: 400 });

  const { data: rows, error: rowsErr } = await pub.rpc("push_tokens_for", { u: userId });
  if (rowsErr) { console.error("tokens", rowsErr); return new Response("error", { status: 500 }); }
  if (!rows || rows.length === 0) return new Response(JSON.stringify({ sent: 0, reason: "no_tokens" }), { status: 200 });

  // Platformen kommer fra registreringen; mangler den (aeldre send-push-kald midt i en
  // udrulning), afgoer token-formatet: APNs er ren hex, FCM baerer ':'.
  const isAndroid = (r: any) => (r.platform ?? (String(r.push_token).includes(":") ? "android" : "ios")) === "android";
  const anyAndroid = (rows as any[]).some(isAndroid);
  const anyIos = (rows as any[]).some((r) => !isAndroid(r));
  if (!Deno.env.get("APNS_KEY") && !anyAndroid) return new Response(JSON.stringify({ error: "apns_not_configured" }), { status: 200 });

  const host = (Deno.env.get("APNS_HOST") ?? "api.push.apple.com")
    .trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
  const topic = Deno.env.get("APNS_BUNDLE_ID") ?? "dk.vibefeed.app";
  const jwt = (anyIos && Deno.env.get("APNS_KEY")) ? await apnsJwt() : null;
  const fcmToken = anyAndroid ? await fcmAccessToken() : null;
  const fcmProject = fcmAccount()?.project_id ?? "";
  const extra: Record<string, unknown> = { kind };
  if (body.pid != null) extra.pid = body.pid;
  if (body.fid != null) extra.fid = body.fid;
  if (body.cid != null) extra.cid = body.cid;
  let sent = 0;
  const errors: string[] = [];
  await Promise.all((rows as any[]).map(async (r) => {
    // r.push_lang = brugerens valgte sprog. Kendt kode -> egne skabeloner, ukendt -> engelsk,
    // manglende (legacy-raekker) -> dansk. tmpl() falder desuden pr. noegle tilbage til engelsk.
    const lang = (r.push_lang && TG[r.push_lang]) ? r.push_lang : (r.push_lang ? "en" : "da");
    const actor = body.actor ?? tmpl(lang, "someone");
    let title = "VibeFeed";
    let text: string;
    if (kind === "chat") {
      text = body.kreds ? fill(tmpl(lang, "chat_kreds"), actor, body.kreds) : fill(tmpl(lang, "chat_dm"), actor);
    } else if (kind === "admitted" || kind === "rejected") {
      text = fill(tmpl(lang, kind), actor, body.kreds || tmpl(lang, "the_kreds"));
    } else {
      const key = kind === "friend" ? "friend_now" : kind;
      text = fill(tmpl(lang, key), actor, body.kreds);
    }
    // Chat i Messenger-stil: titlen baerer personen (+ kredsen), broedteksten er SELVE beskeden.
    if (kind === "chat" && body.msg) {
      title = body.kreds ? `${actor} · ${body.kreds}` : actor;
      text = String(body.msg);
    }
    if (!text) return;

    if (isAndroid(r)) {
      // FCM: RENT data, ingen notification-blok (ellers tegner systemet selv i baggrunden,
      // onMessageReceived springes over, og baade udseendet og deep-linket mistes), alle
      // vaerdier som STRENGE, prioritet HIGH. Ingen badge-kolonne paa Android.
      if (!fcmToken || !fcmProject) { errors.push("fcm_not_configured"); return; }
      const data: Record<string, string> = { title, body: text };
      for (const [k, v] of Object.entries(extra)) data[k] = String(v);
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmProject}/messages:send`, {
          method: "POST",
          headers: { "authorization": `Bearer ${fcmToken}`, "content-type": "application/json" },
          body: JSON.stringify({ message: { token: r.push_token, data, android: { priority: "HIGH" } } }),
        });
        if (res.ok) { sent++; return; }
        const t = await res.text();
        if (res.status === 404 || t.includes("UNREGISTERED") || t.includes("INVALID_ARGUMENT")) {
          await pub.rpc("clear_push_token", { tok: r.push_token });
        }
        errors.push(`fcm ${res.status} ${t.slice(0, 120)}`);
        console.error("fcm", res.status, t);
      } catch (e) { errors.push(`fcm_err ${String(e).slice(0, 160)}`); console.error("fcm_err", String(e)); }
      return;
    }

    if (!jwt) { errors.push("apns_not_configured"); return; }
    let badge = 1;
    try {
      const { data: b } = await pub.rpc("bump_push_badge", { tok: r.push_token });
      if (typeof b === "number") badge = b;
    } catch (_) { /* behold badge=1 */ }
    const payload = JSON.stringify({ aps: { alert: { title, body: text }, sound: "default", badge }, ...extra });
    try {
      const res = await fetch(`https://${host}/3/device/${r.push_token}`, {
        method: "POST",
        headers: { "authorization": `bearer ${jwt}`, "apns-topic": topic, "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json" },
        body: payload,
      });
      if (res.ok) { sent++; return; }
      const t = await res.text();
      if (res.status === 410 || t.includes("BadDeviceToken") || t.includes("Unregistered")) {
        await pub.rpc("clear_push_token", { tok: r.push_token });
      }
      errors.push(`apns ${res.status} ${t.slice(0, 120)}`);
      console.error("apns", res.status, t);
    } catch (e) { errors.push(`apns_err ${String(e).slice(0, 160)}`); console.error("apns_err", String(e)); }
  }));
  return new Response(JSON.stringify({ sent, host, errors: errors.length ? errors : undefined }), { status: 200, headers: { "Content-Type": "application/json" } });
});
