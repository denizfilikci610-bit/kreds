import { sb } from "./config.js";
import { me } from "./store.js";
import { esc, toast } from "./helpers.js";
import { t, stemmerLabel } from "./i18n.js";
import { findPostAll } from "./feed.js";
import { pushNativePostPage } from "./comments.js";
import { scheduleRefetch } from "./realtime.js";

/* ================= Meningsmålinger (stemmerLabel bor nu i i18n.js) ================= */

/* Rå posts-række -> poll-view-model (null hvis opslaget ikke har svarmuligheder) */
export function mapPoll(row){
  const raw = row.poll_options || [];
  if(!raw.length) return null;
  let total = 0, myVote = null;
  const options = raw.slice()
    .sort(function(a,b){ return a.idx - b.idx; })
    .map(function(o){
      const vs = o.poll_votes || [];
      if(me && vs.some(function(v){ return v.user_id === me.id; })) myVote = o.id;
      total += vs.length;
      return { id:o.id, idx:o.idx, text:o.text || "", votes:vs.length };
    });
  // Governance-afstemning? (server-tekst "Afstemning: Skal …" — bruges kun til styling;
  // en bruger kan selv skrive en måling der starter sådan, så præfikset er forfalskbart)
  const gov = typeof row.text === "string" && row.text.indexOf("Afstemning: ") === 0;
  // ÆGTE governance = der findes en membership_proposal for opslaget (embeddet i POST_SELECT;
  // RLS viser den for kredsens medlemmer). KUN den må fjerne knapper — almindelige målinger
  // (også dem der ligner) lukker aldrig og skal beholde deres knapper for evigt.
  const prop = (row.membership_proposals || [])[0];
  // Afgjort? Serveren appender " — Vedtaget ✅"/" — Afvist ❌" til teksten ved afgørelse.
  const done = gov && (row.text.indexOf("✅") >= 0 || row.text.indexOf("❌") >= 0);
  // Sekunder tilbage til fristen (10 min efter oprettelse) — null hvis ikke gov eller allerede afgjort
  let left = null;
  if(gov && row.created_at && !done){
    const deadline = new Date(row.created_at).getTime() + 10 * 60 * 1000;
    left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
  }
  // resolved dækker DB-afgørelsen (proposal.resolved), tekst-markøren (✅/❌) og en lokalt
  // udløbet frist hvor DB'ens lazy close endnu ikke er kørt — serveren afviser alligevel
  // stemmer efter fristen med 'poll_closed'.
  return { options: options, total: total, myVote: myVote, gov: gov, left: left,
           resolved: !!prop && (!!prop.resolved || done || left === 0) };
}

function CHECK(){
  return '<svg class="pcheck" viewBox="0 0 24 24" aria-label="'+t("poll.mine_aria")+'"><circle cx="12" cy="12" r="10" fill="#E0402F"/><path d="M17 9l-6.2 6.2L7 11.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

export function pollHTML(p){
  const poll = p.poll;
  if(!poll) return "";
  // Afgjort governance-afstemning: Ja/Nej "forsvinder" — resultat-rækkerne renderes som
  // ikke-klikbare <div> uden data-vote (klik-delegaten matcher så intet), men slutresultatet
  // kan stadig aflæses. Almindelige meningsmålinger lukker aldrig og beholder deres knapper.
  const resolved = !!(poll.gov && poll.resolved);
  const showRes = resolved || poll.myVote != null || (me && p.u === me.handle);
  let html = '<div class="pollwrap'+(poll.gov ? " gov" : "")+'" data-id="'+p.id+'">';
  if(poll.gov){
    let head = t("gov.vote_label");
    if(resolved) head += " · " + t("poll.closed");
    else if(poll.left != null) head += poll.left > 0
      ? " · " + t("gov.closes_in_min", { m: Math.ceil(poll.left / 60) })
      : " · " + t("gov.closing");
    html += '<div class="gov-head">'+head+'</div>';
  }
  if(showRes){
    poll.options.forEach(function(o){
      const pct = poll.total ? Math.round(o.votes / poll.total * 100) : 0;
      const mine = poll.myVote === o.id;
      const cls = 'poll-res'+(mine ? " mine" : "");
      html += (resolved
          ? '<div class="'+cls+'">'
          : '<button class="'+cls+'" data-vote="'+o.id+'" data-pid="'+p.id+'" aria-label="'+t("poll.vote_aria", { opt: esc(o.text) })+'">')+
        '<span class="pfill" style="width:'+pct+'%"></span>'+
        '<span class="ptxt">'+esc(o.text)+(mine ? CHECK() : '')+'</span>'+
        '<span class="ppct">'+pct+'%</span>'+
      (resolved ? '</div>' : '</button>');
    });
  } else {
    poll.options.forEach(function(o){
      html += '<button class="poll-opt" data-vote="'+o.id+'" data-pid="'+p.id+'">'+esc(o.text)+'</button>';
    });
  }
  if(showRes) html += '<div class="pollmeta">'+stemmerLabel(poll.total)+'</div>';
  html += '</div>';
  return html;
}

function applyVote(poll, from, to){
  if(!poll) return;
  poll.options.forEach(function(o){
    if(from != null && o.id === from) o.votes = Math.max(0, o.votes - 1);
    if(to != null && o.id === to) o.votes++;
  });
  if(from == null && to != null) poll.total++;
  if(from != null && to == null) poll.total = Math.max(0, poll.total - 1);
  poll.myVote = to == null ? null : to;
}
function rerenderPoll(pid){
  const posts = findPostAll(pid);
  if(!posts.length || !posts[0].poll) return;
  const p = posts[0];
  document.querySelectorAll('.post[data-id="'+pid+'"] .pollwrap').forEach(function(w){
    w.outerHTML = pollHTML(p);
  });
  pushNativePostPage(); // målingen på den native opslags-side følger med
}

const voteSeq = new Map();

export async function votePoll(pid, oid){
  if(!me) return;
  pid = Number(pid); oid = Number(oid);
  const posts = findPostAll(pid);
  if(!posts.length || !posts[0].poll) return;
  // Afgjort governance-afstemning: intet klikbart renderes, men gardér alligevel
  // (fx et tap i sekundet før re-render) — serveren ville også afvise ('poll_closed').
  if(posts[0].poll.gov && posts[0].poll.resolved){ toast(t("poll.closed")); return; }
  const prev = posts[0].poll.myVote;
  if(prev === oid) return;
  const seq = (voteSeq.get(pid) || 0) + 1;
  voteSeq.set(pid, seq);
  posts.forEach(function(p){ applyVote(p.poll, prev, oid); });
  rerenderPoll(pid);
  const { error } = await sb.from("poll_votes").upsert(
    { post_id: pid, option_id: oid, user_id: me.id },
    { onConflict: "post_id,user_id" }
  );
  if(error){
    console.error(error);
    if(voteSeq.get(pid) === seq){
      // Kun den seneste stemme for opslaget må rulle optimistisk tilstand tilbage
      posts.forEach(function(p){ applyVote(p.poll, oid, prev); });
      rerenderPoll(pid);
    }
    // Fejlet upsert udløser ingen realtime-hændelse — hent server-tilstand igen
    scheduleRefetch();
    const m = String(error.message || "");
    if(m.indexOf("not_eligible") >= 0) toast(t("poll.not_eligible"));
    else if(m.indexOf("poll_closed") >= 0) toast(t("poll.closed"));
    else if(m.indexOf("bad_option") >= 0) toast(t("poll.bad_option"));
    else toast(t("poll.vote_failed"));
  }
}
