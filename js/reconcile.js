/* ================= Kirurgisk gen-tegning (delt af feed og beskeder) =================
   Både feedet og en besked-tråd blev før bygget som ÉN stor HTML-streng og sat ind med
   innerHTML ved hver eneste render. Alt blev altså revet ned og bygget op igen, hver gang
   bare ét like, én reaktion eller én ny besked ankom, og hvert eneste <img>/<video> blev
   dermed et NYT element, der begyndte sin download forfra fra byte 0. På et smalt net nåede
   et billede derfor bogstaveligt talt aldrig at blive færdigt.

   Her bygges den samme HTML i stedet kort for kort, og hvert korts HTML ER dets signatur:
   er strengen den samme som sidst, røres noderne slet ikke. Kun kort der faktisk har ændret
   sig bygges om, og selv der flyttes det allerede hentede medie med over i det nye kort.
   Resultatet på skærmen er tegn for tegn det samme som før; det er kun DOM-arbejdet, der er
   skåret væk. Fordi signaturen ER outputtet, kan der ikke opstå et kort, der "glemmer" at
   opdatere sig: ændrer noget som helst udseendet, ændrer strengen sig med.

   Et kort må gerne bestå af FLERE rod-elementer (en besked-boble kan fx have en
   "Ulæste beskeder"-linje før sig og en kvittering efter sig) — de holdes samlet som én
   gruppe under samme nøgle. */

/* Gruppens HTML gemmes på dens FØRSTE node. WeakMap, så en fjernet node ikke holdes i live. */
const groupHtml = new WeakMap();

function buildGroup(card){
  const tpl = document.createElement("template");
  tpl.innerHTML = card.html;
  const nodes = Array.prototype.slice.call(tpl.content.children);
  nodes.forEach(function(n){ n.dataset.vfk = card.key; });
  if(nodes.length) groupHtml.set(nodes[0], card.html);
  return nodes;
}

/* Flyt medier der ALLEREDE er hentet (samme tag + samme src) med over i det ombyggede kort,
   så fx et like på et opslag ikke sender dets billede tilbage til byte 0. */
export function keepMedia(selector){
  return function(oldNodes, newNodes){
    const olds = new Map();
    oldNodes.forEach(function(n){
      n.querySelectorAll(selector).forEach(function(m){
        olds.set(m.tagName + "|" + m.getAttribute("src"), m);
      });
    });
    if(!olds.size) return;
    newNodes.forEach(function(n){
      n.querySelectorAll(selector).forEach(function(m){
        const keep = olds.get(m.tagName + "|" + m.getAttribute("src"));
        if(keep) m.replaceWith(keep);
      });
    });
  };
}

/* Bring container'ens børn i overensstemmelse med kort-listen: genbrug uændrede, byg kun
   ændrede om, indsæt nye, fjern dem der er væk. Noder uden data-vfk hører ikke til listen
   (fx en "Henter…"-boks sat direkte med innerHTML) og ryddes, præcis som innerHTML gjorde.
   cards: [{ key, html }] — html må indeholde ét eller flere rod-elementer.
   keep: valgfri funktion (gamleNoder, nyeNoder) der flytter genbrugelige dele med over. */
export function reconcile(container, cards, keep){
  const groups = new Map();
  Array.prototype.slice.call(container.children).forEach(function(n){
    const k = n.dataset ? n.dataset.vfk : null;
    if(!k){ n.remove(); return; }
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  });
  let prev = null;
  cards.forEach(function(c){
    let nodes = groups.get(c.key);
    groups.delete(c.key);
    if(nodes && nodes.length && groupHtml.get(nodes[0]) !== c.html){
      const fresh = buildGroup(c);
      if(keep) keep(nodes, fresh);
      nodes.forEach(function(n){ n.remove(); });
      nodes = fresh;
    } else if(!nodes || !nodes.length){
      nodes = buildGroup(c);
    }
    nodes.forEach(function(n){
      // nextElementSibling (ikke nextSibling): en tilfældig tekstnode må ikke få os til at
      // flytte et kort, der i virkeligheden allerede står rigtigt — et flyt pauser en video.
      const want = prev ? prev.nextElementSibling : container.firstElementChild;
      if(n !== want) container.insertBefore(n, want);
      prev = n;
    });
  });
  groups.forEach(function(ns){ ns.forEach(function(n){ n.remove(); }); });
}
