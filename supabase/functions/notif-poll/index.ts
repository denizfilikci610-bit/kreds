// Background notification polling for the iOS app (localized da/en).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Notifikations-skabeloner på alle 32 UI-sprog. Ren DATA ({n}=navn, {k}=kreds), delt
// med send-push. body.lang = brugerens valgte sprog; ukendt → engelsk, manglende → dansk.
const FALLBACK: Record<string, Record<string, string>> = {"da": {"a_friend": "En ven", "a_kreds": "en kreds", "admitted": "Du er blevet optaget i “{k}” 🎉", "chat_dm": "{n} sendte dig en besked", "chat_kreds": "{n} skrev i “{k}”", "comment": "{n} svarede på dit opslag", "comment_like": "{n} likede din kommentar", "friend_now": "{n} blev din ven", "friend_request": "{n} sendte dig en venneanmodning", "invite": "{n} har inviteret dig til “{k}”", "kreq": "{n} vil gerne være med i “{k}”", "like": "{n} likede dit opslag", "mention": "{n} nævnte dig", "post": "{n} delte et opslag", "post_kreds": "{n} delte et opslag i “{k}”", "rejected": "Din optagelse i “{k}” blev ikke vedtaget", "reply": "{n} svarede på din kommentar", "someone": "Nogen", "the_kreds": "kredsen"}, "en": {"a_friend": "A friend", "a_kreds": "a kreds", "admitted": "You’ve been admitted to “{k}” 🎉", "chat_dm": "{n} sent you a message", "chat_kreds": "{n} wrote in “{k}”", "comment": "{n} replied to your post", "comment_like": "{n} liked your comment", "friend_now": "{n} is now your friend", "friend_request": "{n} sent you a friend request", "invite": "{n} invited you to “{k}”", "kreq": "{n} wants to join “{k}”", "like": "{n} liked your post", "mention": "{n} mentioned you", "post": "{n} shared a post", "post_kreds": "{n} shared a post in “{k}”", "rejected": "Your admission to “{k}” wasn’t approved", "reply": "{n} replied to your comment", "someone": "Someone", "the_kreds": "the kreds"}};
// De øvrige 30 sprog hentes fra den git-styrede fil på vibefeed.dk (cached pr. cold-start).
// Fejler hentningen, bruges FALLBACK (da/en), så push/poll ALDRIG går i stå.
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

function out(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Deep-link payload pr. event (spejler APNs custom keys): pid = opslag,
// fid = kreds, cid = kommentar. NotifManager lægger dem i userInfo, så et
// tap på den lokale notifikation kan åbne præcis det opslag/den kommentar.
type Ev = { kind: string; text: string; at: string; pid?: number; fid?: string; cid?: number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  await loadT();

  let body: { secret?: string; since?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return out({ error: "bad_request" }, 400);
  }
  const secret = String(body.secret ?? "");
  if (!/^[0-9a-f-]{36}$/.test(secret)) return out({ error: "forbidden" }, 403);
  const lang = (body.lang && TG[body.lang]) ? body.lang : (body.lang ? "en" : "da");

  const now = Date.now();
  let since = new Date(now - 48 * 3600 * 1000);
  const parsed = body.since ? new Date(body.since) : null;
  if (parsed && !isNaN(parsed.getTime()) && parsed.getTime() > since.getTime()) {
    since = parsed;
  }
  const sinceIso = since.toISOString();

  const pub = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: uid, error: lookErr } = await pub.rpc("device_token_user", { s: secret });
  if (lookErr || !uid) return out({ error: "forbidden" }, 403);

  const events: Ev[] = [];

  // BLOKERING: service-role bypasser RLS, så vi filtrerer selv. Sættet er
  // begge retninger (jeg blokerede dem / de blokerede mig) — indhold på tværs
  // af en blokering må aldrig blive til en notifikation. Dækker også GAMLE
  // rækker fra før blokeringen, som stadig ligger i 48-timers-vinduet.
  const { data: blockedRows } = await pub.from("blocked_users")
    .select("blocker, blocked")
    .or(`blocker.eq.${uid},blocked.eq.${uid}`);
  const blockedSet = new Set<string>();
  for (const b of blockedRows ?? []) {
    blockedSet.add((b as any).blocker === uid ? (b as any).blocked : (b as any).blocker);
  }
  const isBlocked = (id?: string | null) => !!id && blockedSet.has(id);

  const { data: friends } = await pub.from("friendships")
    .select("friend_id").eq("user_id", uid);
  const friendIds = (friends ?? []).map((r) => r.friend_id);
  const { data: memberships } = await pub.from("feed_members")
    .select("feed_id, created_at").eq("user_id", uid);
  const feedIds = (memberships ?? []).map((r) => r.feed_id);
  // Indmeldelses-tidspunkt pr. kreds: opslag fra FØR man kom med giver ALDRIG notifikation
  const joinedAt: Record<string, number> = {};
  for (const m of memberships ?? []) {
    joinedAt[(m as any).feed_id] = new Date((m as any).created_at).getTime();
  }

  if (friendIds.length) {
    const { data: posts } = await pub.from("posts")
      .select("id, author, created_at, feed_id, author_profile:profiles!author(name), feed:feeds!feed_id(name)")
      .gt("created_at", sinceIso)
      .neq("author", uid)
      .or(feedIds.length
        ? `and(feed_id.is.null,author.in.(${friendIds.join(",")})),feed_id.in.(${feedIds.join(",")})`
        : `and(feed_id.is.null,author.in.(${friendIds.join(",")}))`)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const p of posts ?? []) {
      if (isBlocked((p as any).author)) continue; // blokeret forfatter (fx fælles kreds)
      const fid = (p as any).feed_id as string | null;
      if (fid && new Date(p.created_at).getTime() <= (joinedAt[fid] ?? 0)) continue; // fra før min indmeldelse
      const name = (p as any).author_profile?.name ?? tmpl(lang, "a_friend");
      const kreds = (p as any).feed?.name;
      const ev: Ev = {
        kind: kreds ? "post_kreds" : "post",
        text: kreds ? fill(tmpl(lang, "post_kreds"), name, kreds) : fill(tmpl(lang, "post"), name),
        at: p.created_at,
        pid: (p as any).id,
      };
      if (fid) ev.fid = fid;
      events.push(ev);
    }
  }

  const { data: myPosts } = await pub.from("posts").select("id").eq("author", uid);
  const myIds = (myPosts ?? []).map((r) => r.id);
  const { data: myCmts } = await pub.from("comments").select("id").eq("author", uid);
  const myCmtIds = (myCmts ?? []).map((r) => r.id);

  // Svar PÅ mine kommentarer + likes på mine kommentarer. replyIds bruges nedenfor til at
  // undgå at et svar (på en af MINE kommentarer) også udsendes som "kommentar på dit opslag".
  const replyIds = new Set<number>();
  if (myCmtIds.length) {
    const { data: replies } = await pub.from("comments")
      .select("id, author, post_id, created_at, author_profile:profiles!author(name)")
      .in("parent_id", myCmtIds).neq("author", uid)
      .gt("created_at", sinceIso).limit(5);
    for (const r of replies ?? []) {
      if (isBlocked((r as any).author)) continue;
      replyIds.add((r as any).id);
      events.push({ kind: "reply", text: fill(tmpl(lang, "reply"), (r as any).author_profile?.name ?? tmpl(lang, "someone")), at: r.created_at, pid: (r as any).post_id, cid: (r as any).id });
    }
    const { data: clikes } = await pub.from("comment_likes")
      .select("comment_id, user_id, created_at, comment:comments!comment_id(post_id), liker:profiles!user_id(name)")
      .in("comment_id", myCmtIds).neq("user_id", uid)
      .gt("created_at", sinceIso).limit(5);
    for (const c of clikes ?? []) {
      if (isBlocked((c as any).user_id)) continue;
      const ev: Ev = { kind: "comment_like", text: fill(tmpl(lang, "comment_like"), (c as any).liker?.name ?? tmpl(lang, "someone")), at: c.created_at, cid: (c as any).comment_id };
      if ((c as any).comment?.post_id != null) ev.pid = (c as any).comment.post_id;
      events.push(ev);
    }
  }

  if (myIds.length) {
    const { data: likes } = await pub.from("likes")
      .select("post_id, user_id, created_at, liker:profiles!user_id(name)")
      .in("post_id", myIds).neq("user_id", uid)
      .gt("created_at", sinceIso).limit(5);
    for (const l of likes ?? []) {
      if (isBlocked((l as any).user_id)) continue;
      events.push({ kind: "like", text: fill(tmpl(lang, "like"), (l as any).liker?.name ?? tmpl(lang, "someone")), at: l.created_at, pid: (l as any).post_id });
    }
    // ALLE kommentarer på mine opslag (inkl. svar på ANDRES kommentarer i min tråd);
    // svar på MINE egne kommentarer er allerede udsendt som "reply" ovenfor (replyIds).
    const { data: cmts } = await pub.from("comments")
      .select("id, author, post_id, created_at, author_profile:profiles!author(name)")
      .in("post_id", myIds).neq("author", uid)
      .gt("created_at", sinceIso).limit(5);
    for (const c of cmts ?? []) {
      if (replyIds.has((c as any).id)) continue;
      if (isBlocked((c as any).author)) continue;
      events.push({ kind: "comment", text: fill(tmpl(lang, "comment"), (c as any).author_profile?.name ?? tmpl(lang, "someone")), at: c.created_at, pid: (c as any).post_id, cid: (c as any).id });
    }
  }

  // Ven-anmodninger TIL mig (filtrér på created_at; accept/afvis er en DELETE, ingen resurface)
  const { data: freqs } = await pub.from("friend_requests")
    .select("from_id, created_at, from_profile:profiles!from_id(name)")
    .eq("to_id", uid).gt("created_at", sinceIso).limit(5);
  for (const f of freqs ?? []) {
    if (isBlocked((f as any).from_id)) continue;
    events.push({ kind: "friend_request", text: fill(tmpl(lang, "friend_request"), (f as any).from_profile?.name ?? tmpl(lang, "someone")), at: f.created_at });
  }

  const { data: invites } = await pub.from("kreds_invites")
    .select("feed_id, invited_by, created_at, feed:feeds!feed_id(name), inviter:profiles!invited_by(name)")
    .eq("user_id", uid).gt("created_at", sinceIso).limit(5);
  for (const i of invites ?? []) {
    if (isBlocked((i as any).invited_by)) continue;
    events.push({
      kind: "invite",
      text: fill(tmpl(lang, "invite"), (i as any).inviter?.name ?? tmpl(lang, "someone"), (i as any).feed?.name ?? tmpl(lang, "a_kreds")),
      at: i.created_at,
      fid: (i as any).feed_id,
    });
  }

  // @-mentions af mig (mentions-tabellen udfyldes af DB-triggeren)
  const { data: mentions } = await pub.from("mentions")
    .select("post_id, comment_id, author, created_at, author_profile:profiles!author(name)")
    .eq("mentioned", uid).gt("created_at", sinceIso).limit(5);
  for (const m of mentions ?? []) {
    if (isBlocked((m as any).author)) continue;
    const ev: Ev = { kind: "mention", text: fill(tmpl(lang, "mention"), (m as any).author_profile?.name ?? tmpl(lang, "someone")), at: m.created_at, pid: (m as any).post_id };
    if ((m as any).comment_id != null) ev.cid = (m as any).comment_id;
    events.push(ev);
  }

  // Chat-beskeder i mine tråde. Delings-beskeder (post_id) springes over — de dækkes
  // af opslags-events ovenfor. Mutede tråde, blokerede afsendere, allerede læste
  // beskeder og beskeder fra før min indmeldelse giver ingen notifikation.
  if (feedIds.length) {
    const { data: mutedRows } = await pub.from("kreds_chat_prefs")
      .select("feed_id").eq("user_id", uid).eq("muted", true);
    const mutedSet = new Set((mutedRows ?? []).map((r) => (r as any).feed_id));
    const { data: readsRows } = await pub.from("kreds_chat_reads")
      .select("feed_id, last_read_at").eq("user_id", uid);
    const readAt: Record<string, number> = {};
    for (const r of readsRows ?? []) {
      readAt[(r as any).feed_id] = new Date((r as any).last_read_at).getTime();
    }
    const { data: chats } = await pub.from("kreds_messages")
      .select("id, feed_id, author, created_at, post_id, author_profile:profiles!author(name), feed:feeds!feed_id(name, is_dm)")
      .in("feed_id", feedIds).neq("author", uid).is("post_id", null)
      .gt("created_at", sinceIso)
      .order("created_at", { ascending: false }).limit(10);
    for (const c of chats ?? []) {
      const fid = (c as any).feed_id as string;
      if (mutedSet.has(fid)) continue;
      if (isBlocked((c as any).author)) continue;
      const ts = new Date(c.created_at).getTime();
      if (ts <= (readAt[fid] ?? 0)) continue;
      if (ts <= (joinedAt[fid] ?? 0)) continue;
      const name = (c as any).author_profile?.name ?? tmpl(lang, "someone");
      const isDm = !!(c as any).feed?.is_dm;
      events.push({
        kind: "chat",
        text: isDm ? fill(tmpl(lang, "chat_dm"), name) : fill(tmpl(lang, "chat_kreds"), name, (c as any).feed?.name ?? tmpl(lang, "a_kreds")),
        at: c.created_at,
        fid,
      });
    }
  }

  // Dedupe: en mention er den PRÆCISE udgave af samme hændelse — den generiske
  // kommentar/svar (samme cid) eller opslag (samme pid) skjules, så en @-omtale i en
  // kommentar ikke giver TO notifikationer. Push-triggerne (tg_push_comment/
  // tg_push_post) og notifikationslisten (js/notifications.js) gør præcis det samme;
  // poll-fallbacken manglede det (fund 8, app-eftersyn 2026-07-21).
  const menCids = new Set<number>();
  const menPids = new Set<number>();
  for (const e of events) {
    if (e.kind === "mention") {
      if (e.cid != null) menCids.add(e.cid);
      else if (e.pid != null) menPids.add(e.pid);
    }
  }
  const deduped = events.filter((e) => {
    if ((e.kind === "comment" || e.kind === "reply") && e.cid != null && menCids.has(e.cid)) return false;
    if ((e.kind === "post" || e.kind === "post_kreds") && e.pid != null && menPids.has(e.pid)) return false;
    return true;
  });

  deduped.sort((a, b) => (a.at < b.at ? 1 : -1));
  // NotifManager (iOS) renderérer kun events.prefix(5); returnér derfor højst 5, så intet
  // droppes stille mens “now”-vandmærket rykkes frem (ellers gik event 6-10 tabt).
  return out({ events: deduped.slice(0, 5), now: new Date(now).toISOString() });
});
