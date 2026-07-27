// Stores a push device token (APNs or FCM) against a device secret (issued by issue_device_token).
// Called by the iOS app after registering for remote notifications, and by the Android app
// after fetching its FCM token. The client contract is unchanged: {secret, token, lang}.
// The platform is derived SERVER-side from the token format: APNs tokens are pure hex,
// FCM tokens carry ':' (and '-'/'_') and are longer. Clients never send a platform field.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405, headers: cors });

  let body: { secret?: string; token?: string; lang?: string };
  try { body = await req.json(); } catch { return new Response("bad_request", { status: 400, headers: cors }); }

  const secret = String(body.secret ?? "");
  const token = String(body.token ?? "");
  // Hele sprogkoden bevares ("de", "zh-hans") - send-push har skabeloner paa alle 32 sprog
  // og falder selv tilbage til engelsk ved ukendt kode. Ugyldigt format bliver til dansk.
  const rawLang = String(body.lang ?? "").toLowerCase();
  const lang = /^[a-z]{2}(-[a-z0-9]{2,8})?$/.test(rawLang) ? rawLang : "da";
  if (!/^[0-9a-f-]{36}$/.test(secret)) return new Response("forbidden", { status: 403, headers: cors });

  // APNs: ren hex. FCM: base64url-agtigt med ':' som skilletegn. Alt andet afvises.
  let platform: string;
  if (/^[0-9a-f]{20,200}$/i.test(token)) platform = "ios";
  else if (/^[A-Za-z0-9_:.\-]{20,300}$/.test(token) && token.includes(":")) platform = "android";
  else return new Response("bad_request", { status: 400, headers: cors });

  const pub = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // app_hidden is NOT exposed to PostgREST, so a direct .schema("app_hidden").from(...) update 500s.
  // Go through a SECURITY DEFINER RPC instead (same approach as notif-poll's device_token_user).
  const { data, error } = await pub.rpc("store_push_token", { s: secret, tok: token, lng: lang, plat: platform });
  if (error) { console.error(error); return new Response("error", { status: 500, headers: cors }); }
  if (data !== true) return new Response("forbidden", { status: 403, headers: cors }); // no device row for this secret
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
});
