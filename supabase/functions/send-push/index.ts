// Sends an APNs push to all of a user's registered devices. Called by DB triggers (via pg_net).
// Auth: the trigger passes x-push-secret = app_hidden.push_hook.secret; checked via RPC.
// app_hidden is NOT exposed to PostgREST, so all reads/writes go through SECURITY DEFINER RPCs.
// Required secrets: APNS_KEY (.p8), APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID.
// APNS_HOST er VALGFRI override — default er PRODUKTION (App Store/TestFlight-builds).
// Sæt APNS_HOST=api.sandbox.push.apple.com hvis der udvikles med Xcode-builds igen.
import { createClient } from "npm:@supabase/supabase-js@2";

// Notifikations-skabeloner på alle 32 UI-sprog. Ren DATA (strings med {n}=navn, {k}=kreds),
// ikke kode — så en oversættelse aldrig kan bryde funktionen. r.push_lang er brugerens
// VALGTE sprog; ukendt kode → engelsk, manglende (legacy) → dansk. Pr. nøgle falder en
// manglende streng også tilbage til engelsk.
const T: Record<string, Record<string, string>> = {
  "da": { "post_kreds": "{n} delte et opslag i “{k}”", "post": "{n} delte et opslag", "like": "{n} likede dit opslag", "comment": "{n} svarede på dit opslag", "comment_like": "{n} likede din kommentar", "reply": "{n} svarede på din kommentar", "friend_request": "{n} sendte dig en venneanmodning", "friend_now": "{n} blev din ven", "invite": "{n} har inviteret dig til “{k}”", "kreq": "{n} vil gerne være med i “{k}”", "mention": "{n} nævnte dig", "chat_dm": "{n} sendte dig en besked", "chat_kreds": "{n} skrev i “{k}”", "admitted": "Du er blevet optaget i “{k}” 🎉", "rejected": "Din optagelse i “{k}” blev ikke vedtaget", "someone": "Nogen", "the_kreds": "kredsen", "a_kreds": "en kreds", "a_friend": "En ven" },
  "en": { "post_kreds": "{n} shared a post in “{k}”", "post": "{n} shared a post", "like": "{n} liked your post", "comment": "{n} replied to your post", "comment_like": "{n} liked your comment", "reply": "{n} replied to your comment", "friend_request": "{n} sent you a friend request", "friend_now": "{n} is now your friend", "invite": "{n} invited you to “{k}”", "kreq": "{n} wants to join “{k}”", "mention": "{n} mentioned you", "chat_dm": "{n} sent you a message", "chat_kreds": "{n} wrote in “{k}”", "admitted": "You’ve been admitted to “{k}” 🎉", "rejected": "Your admission to “{k}” wasn’t approved", "someone": "Someone", "the_kreds": "the kreds", "a_kreds": "a kreds", "a_friend": "A friend" },
  "af": { "post_kreds": "{n} het 'n plasing in \"{k}\" gedeel", "post": "{n} het 'n plasing gedeel", "like": "{n} het jou plasing gelike", "comment": "{n} het op jou plasing geantwoord", "comment_like": "{n} het jou kommentaar gelike", "reply": "{n} het op jou kommentaar geantwoord", "friend_request": "{n} het jou 'n vriendskapsversoek gestuur", "friend_now": "{n} is nou jou vriend", "invite": "{n} het jou na \"{k}\" genooi", "kreq": "{n} wil by \"{k}\" aansluit", "mention": "{n} het jou genoem", "chat_dm": "{n} het jou 'n boodskap gestuur", "chat_kreds": "{n} het in \"{k}\" geskryf", "admitted": "Jy is in \"{k}\" toegelaat 🎉", "rejected": "Jou toelating tot \"{k}\" is nie goedgekeur nie", "someone": "Iemand", "the_kreds": "die kring", "a_kreds": "'n kring", "a_friend": "'n Vriend" },
  "ar": { "post_kreds": "شارك {n} منشورًا في «{k}»", "post": "شارك {n} منشورًا", "like": "أعجب {n} بمنشورك", "comment": "رد {n} على منشورك", "comment_like": "أعجب {n} بتعليقك", "reply": "رد {n} على تعليقك", "friend_request": "أرسل لك {n} طلب صداقة", "friend_now": "أصبح {n} في دائرتك", "invite": "دعاك {n} إلى «{k}»", "kreq": "يريد {n} الانضمام إلى «{k}»", "mention": "ذكرك {n}", "chat_dm": "أرسل لك {n} رسالة", "chat_kreds": "كتب {n} في «{k}»", "admitted": "تم قبولك في «{k}» 🎉", "rejected": "لم يُقبل طلب انضمامك إلى «{k}»", "someone": "شخص ما", "the_kreds": "الدائرة", "a_kreds": "دائرة", "a_friend": "صديق" },
  "cs": { "post_kreds": "{n} sdílel(a) příspěvek v „{k}“", "post": "{n} sdílel(a) příspěvek", "like": "{n} lajkoval(a) tvůj příspěvek", "comment": "{n} odpověděl(a) na tvůj příspěvek", "comment_like": "{n} lajkoval(a) tvůj komentář", "reply": "{n} odpověděl(a) na tvůj komentář", "friend_request": "{n} ti poslal(a) žádost o přátelství", "friend_now": "{n} je teď tvůj přítel", "invite": "{n} tě pozval(a) do „{k}“", "kreq": "{n} chce do „{k}“", "mention": "{n} tě zmínil(a)", "chat_dm": "{n} ti poslal(a) zprávu", "chat_kreds": "{n} napsal(a) v „{k}“", "admitted": "Byl(a) jsi přijat(a) do „{k}“ 🎉", "rejected": "Tvoje přijetí do „{k}“ neprošlo", "someone": "Někdo", "the_kreds": "kruh", "a_kreds": "kruh", "a_friend": "Přítel" },
  "de": { "post_kreds": "{n} hat einen Beitrag in „{k}“ geteilt", "post": "{n} hat einen Beitrag geteilt", "like": "{n} hat deinen Beitrag gelikt", "comment": "{n} hat auf deinen Beitrag geantwortet", "comment_like": "{n} hat deinen Kommentar gelikt", "reply": "{n} hat auf deinen Kommentar geantwortet", "friend_request": "{n} hat dir eine Freundschaftsanfrage geschickt", "friend_now": "{n} ist jetzt dein Freund", "invite": "{n} hat dich zu „{k}“ eingeladen", "kreq": "{n} möchte bei „{k}“ mitmachen", "mention": "{n} hat dich erwähnt", "chat_dm": "{n} hat dir eine Nachricht geschickt", "chat_kreds": "{n} hat in „{k}“ geschrieben", "admitted": "Du bist jetzt in „{k}“ 🎉", "rejected": "Deine Aufnahme in „{k}“ wurde nicht angenommen", "someone": "Jemand", "the_kreds": "der Kreis", "a_kreds": "ein Kreis", "a_friend": "Ein Freund" },
  "el": { "post_kreds": "Ο/Η {n} μοιράστηκε μια ανάρτηση στο «{k}»", "post": "Ο/Η {n} μοιράστηκε μια ανάρτηση", "like": "Ο/Η {n} έκανε like στην ανάρτησή σου", "comment": "Ο/Η {n} απάντησε στην ανάρτησή σου", "comment_like": "Ο/Η {n} έκανε like στο σχόλιό σου", "reply": "Ο/Η {n} απάντησε στο σχόλιό σου", "friend_request": "Ο/Η {n} σου έστειλε αίτημα φιλίας", "friend_now": "Ο/Η {n} είναι τώρα φίλος σου", "invite": "Ο/Η {n} σε προσκάλεσε στο «{k}»", "kreq": "Ο/Η {n} θέλει να μπει στο «{k}»", "mention": "Ο/Η {n} σε ανέφερε", "chat_dm": "Ο/Η {n} σου έστειλε ένα μήνυμα", "chat_kreds": "Ο/Η {n} έγραψε στο «{k}»", "admitted": "Έγινες δεκτός/ή στο «{k}» 🎉", "rejected": "Η ένταξή σου στο «{k}» δεν εγκρίθηκε", "someone": "Κάποιος", "the_kreds": "ο κύκλος", "a_kreds": "ένας κύκλος", "a_friend": "Ένας φίλος" },
  "es": { "post_kreds": "{n} compartió una publicación en \"{k}\"", "post": "{n} compartió una publicación", "like": "A {n} le gustó tu publicación", "comment": "{n} respondió a tu publicación", "comment_like": "A {n} le gustó tu comentario", "reply": "{n} respondió a tu comentario", "friend_request": "{n} te envió una solicitud de amistad", "friend_now": "{n} ya es tu amigo", "invite": "{n} te ha invitado a \"{k}\"", "kreq": "{n} quiere entrar en \"{k}\"", "mention": "{n} te mencionó", "chat_dm": "{n} te envió un mensaje", "chat_kreds": "{n} escribió en \"{k}\"", "admitted": "Ya formas parte de \"{k}\" 🎉", "rejected": "Tu admisión en \"{k}\" no fue aprobada", "someone": "Alguien", "the_kreds": "el círculo", "a_kreds": "un círculo", "a_friend": "Un amigo" },
  "fa": { "post_kreds": "{n} یک پست در «{k}» به اشتراک گذاشت", "post": "{n} یک پست به اشتراک گذاشت", "like": "{n} پستت را لایک کرد", "comment": "{n} به پستت جواب داد", "comment_like": "{n} نظرت را لایک کرد", "reply": "{n} به نظرت جواب داد", "friend_request": "{n} برایت درخواست دوستی فرستاد", "friend_now": "{n} حالا دوست توست", "invite": "{n} تو را به «{k}» دعوت کرد", "kreq": "{n} می‌خواهد وارد «{k}» شود", "mention": "{n} از تو نام برد", "chat_dm": "{n} برایت پیام فرستاد", "chat_kreds": "{n} در «{k}» نوشت", "admitted": "به «{k}» راه یافتی 🎉", "rejected": "پذیرش تو در «{k}» تصویب نشد", "someone": "کسی", "the_kreds": "حلقه", "a_kreds": "یک حلقه", "a_friend": "یک دوست" },
  "fi": { "post_kreds": "{n} jakoi julkaisun piirissä ”{k}”", "post": "{n} jakoi julkaisun", "like": "{n} tykkäsi julkaisustasi", "comment": "{n} vastasi julkaisuusi", "comment_like": "{n} tykkäsi kommentistasi", "reply": "{n} vastasi kommenttiisi", "friend_request": "{n} lähetti sinulle ystäväpyynnön", "friend_now": "{n} on nyt ystäväsi", "invite": "{n} kutsui sinut piiriin ”{k}”", "kreq": "{n} haluaa mukaan piiriin ”{k}”", "mention": "{n} mainitsi sinut", "chat_dm": "{n} lähetti sinulle viestin", "chat_kreds": "{n} kirjoitti piirissä ”{k}”", "admitted": "Sinut on hyväksytty piiriin ”{k}” 🎉", "rejected": "Pääsysi piiriin ”{k}” ei mennyt läpi", "someone": "Joku", "the_kreds": "piiri", "a_kreds": "piiri", "a_friend": "Ystävä" },
  "fr": { "post_kreds": "{n} a partagé une publication dans « {k} »", "post": "{n} a partagé une publication", "like": "{n} a aimé ta publication", "comment": "{n} a répondu à ta publication", "comment_like": "{n} a aimé ton commentaire", "reply": "{n} a répondu à ton commentaire", "friend_request": "{n} t’a envoyé une demande d’ami", "friend_now": "{n} est maintenant ton ami", "invite": "{n} t’a invité à « {k} »", "kreq": "{n} souhaite rejoindre « {k} »", "mention": "{n} t’a mentionné", "chat_dm": "{n} t’a envoyé un message", "chat_kreds": "{n} a écrit dans « {k} »", "admitted": "Tu fais maintenant partie de « {k} » 🎉", "rejected": "Ton admission dans « {k} » n’a pas été acceptée", "someone": "Quelqu’un", "the_kreds": "le cercle", "a_kreds": "un cercle", "a_friend": "Un ami" },
  "he": { "post_kreds": "{n} שיתף פוסט ב-\"{k}\"", "post": "{n} שיתף פוסט", "like": "{n} עשה לייק לפוסט שלך", "comment": "{n} הגיב לפוסט שלך", "comment_like": "{n} עשה לייק לתגובה שלך", "reply": "{n} הגיב לתגובה שלך", "friend_request": "{n} שלח לך בקשת חברות", "friend_now": "{n} עכשיו במעגל שלך", "invite": "{n} הזמין אותך ל-\"{k}\"", "kreq": "{n} רוצה להצטרף ל-\"{k}\"", "mention": "{n} הזכיר אותך", "chat_dm": "{n} שלח לך הודעה", "chat_kreds": "{n} כתב ב-\"{k}\"", "admitted": "התקבלת ל-\"{k}\" 🎉", "rejected": "הבקשה שלך להצטרף ל-\"{k}\" לא עברה", "someone": "מישהו", "the_kreds": "המעגל", "a_kreds": "מעגל", "a_friend": "חבר" },
  "hi": { "post_kreds": "{n} ने \"{k}\" में एक पोस्ट शेयर की", "post": "{n} ने एक पोस्ट शेयर की", "like": "{n} ने आपकी पोस्ट लाइक की", "comment": "{n} ने आपकी पोस्ट का जवाब दिया", "comment_like": "{n} ने आपकी टिप्पणी लाइक की", "reply": "{n} ने आपकी टिप्पणी का जवाब दिया", "friend_request": "{n} ने आपको दोस्ती का अनुरोध भेजा", "friend_now": "{n} अब आपके दोस्त हैं", "invite": "{n} ने आपको \"{k}\" में आमंत्रित किया", "kreq": "{n} \"{k}\" में शामिल होना चाहते हैं", "mention": "{n} ने आपका ज़िक्र किया", "chat_dm": "{n} ने आपको एक संदेश भेजा", "chat_kreds": "{n} ने \"{k}\" में लिखा", "admitted": "अब आप \"{k}\" में शामिल हैं 🎉", "rejected": "\"{k}\" में आपकी सदस्यता पास नहीं हुई", "someone": "कोई", "the_kreds": "सर्कल", "a_kreds": "एक सर्कल", "a_friend": "एक दोस्त" },
  "id": { "post_kreds": "{n} membagikan postingan di \"{k}\"", "post": "{n} membagikan postingan", "like": "{n} menyukai postinganmu", "comment": "{n} membalas postinganmu", "comment_like": "{n} menyukai komentarmu", "reply": "{n} membalas komentarmu", "friend_request": "{n} mengirimimu permintaan pertemanan", "friend_now": "{n} sekarang temanmu", "invite": "{n} mengundangmu ke \"{k}\"", "kreq": "{n} ingin bergabung ke \"{k}\"", "mention": "{n} menyebutmu", "chat_dm": "{n} mengirimimu pesan", "chat_kreds": "{n} menulis di \"{k}\"", "admitted": "Kamu diterima di \"{k}\" 🎉", "rejected": "Penerimaanmu di \"{k}\" tidak disetujui", "someone": "Seseorang", "the_kreds": "lingkaran", "a_kreds": "sebuah lingkaran", "a_friend": "Seorang teman" },
  "it": { "post_kreds": "{n} ha condiviso un post in \"{k}\"", "post": "{n} ha condiviso un post", "like": "A {n} piace il tuo post", "comment": "{n} ha risposto al tuo post", "comment_like": "A {n} piace il tuo commento", "reply": "{n} ha risposto al tuo commento", "friend_request": "{n} ti ha inviato una richiesta di amicizia", "friend_now": "{n} è ora tuo amico", "invite": "{n} ti ha invitato a \"{k}\"", "kreq": "{n} vuole entrare in \"{k}\"", "mention": "{n} ti ha menzionato", "chat_dm": "{n} ti ha inviato un messaggio", "chat_kreds": "{n} ha scritto in \"{k}\"", "admitted": "Sei stato ammesso in \"{k}\" 🎉", "rejected": "La tua ammissione in \"{k}\" non è stata approvata", "someone": "Qualcuno", "the_kreds": "la cerchia", "a_kreds": "una cerchia", "a_friend": "Un amico" },
  "ja": { "post_kreds": "{n}さんが「{k}」に投稿しました", "post": "{n}さんが投稿しました", "like": "{n}さんがあなたの投稿にいいねしました", "comment": "{n}さんがあなたの投稿に返信しました", "comment_like": "{n}さんがあなたのコメントにいいねしました", "reply": "{n}さんがあなたのコメントに返信しました", "friend_request": "{n}さんから友達リクエストが届きました", "friend_now": "{n}さんと友達になりました", "invite": "{n}さんが「{k}」に招待しました", "kreq": "{n}さんが「{k}」への参加を希望しています", "mention": "{n}さんがあなたをメンションしました", "chat_dm": "{n}さんからメッセージが届きました", "chat_kreds": "{n}さんが「{k}」に書き込みました", "admitted": "「{k}」のメンバーになりました 🎉", "rejected": "「{k}」への参加は通りませんでした", "someone": "誰か", "the_kreds": "サークル", "a_kreds": "あるサークル", "a_friend": "友達" },
  "ko": { "post_kreds": "{n}님이 \"{k}\"에 게시물을 공유했어요", "post": "{n}님이 게시물을 공유했어요", "like": "{n}님이 내 게시물에 좋아요를 눌렀어요", "comment": "{n}님이 내 게시물에 답글을 달았어요", "comment_like": "{n}님이 내 댓글에 좋아요를 눌렀어요", "reply": "{n}님이 내 댓글에 답글을 달았어요", "friend_request": "{n}님이 친구 요청을 보냈어요", "friend_now": "{n}님이 내 친구가 되었어요", "invite": "{n}님이 \"{k}\"에 초대했어요", "kreq": "{n}님이 \"{k}\"에 들어오고 싶어 해요", "mention": "{n}님이 나를 언급했어요", "chat_dm": "{n}님이 메시지를 보냈어요", "chat_kreds": "{n}님이 \"{k}\"에 글을 남겼어요", "admitted": "\"{k}\"의 멤버가 되었어요 🎉", "rejected": "\"{k}\" 가입이 통과되지 않았어요", "someone": "누군가", "the_kreds": "서클", "a_kreds": "어떤 서클", "a_friend": "친구" },
  "ms": { "post_kreds": "{n} berkongsi satu kiriman dalam \"{k}\"", "post": "{n} berkongsi satu kiriman", "like": "{n} menyukai kiriman anda", "comment": "{n} membalas kiriman anda", "comment_like": "{n} menyukai komen anda", "reply": "{n} membalas komen anda", "friend_request": "{n} menghantar permintaan berkawan", "friend_now": "{n} kini rakan anda", "invite": "{n} menjemput anda ke \"{k}\"", "kreq": "{n} mahu menyertai \"{k}\"", "mention": "{n} menyebut anda", "chat_dm": "{n} menghantar mesej kepada anda", "chat_kreds": "{n} menulis dalam \"{k}\"", "admitted": "Anda telah diterima ke dalam \"{k}\" 🎉", "rejected": "Kemasukan anda ke \"{k}\" tidak diluluskan", "someone": "Seseorang", "the_kreds": "bulatan itu", "a_kreds": "sebuah bulatan", "a_friend": "Seorang rakan" },
  "nl": { "post_kreds": "{n} deelde een bericht in \"{k}\"", "post": "{n} deelde een bericht", "like": "{n} vond je bericht leuk", "comment": "{n} reageerde op je bericht", "comment_like": "{n} vond je reactie leuk", "reply": "{n} reageerde op je reactie", "friend_request": "{n} stuurde je een vriendschapsverzoek", "friend_now": "{n} zit nu in jouw kring", "invite": "{n} heeft je uitgenodigd voor \"{k}\"", "kreq": "{n} wil bij \"{k}\" komen", "mention": "{n} noemde je", "chat_dm": "{n} stuurde je een bericht", "chat_kreds": "{n} schreef in \"{k}\"", "admitted": "Je bent toegelaten tot \"{k}\" 🎉", "rejected": "Je toelating tot \"{k}\" is niet aangenomen", "someone": "Iemand", "the_kreds": "de kring", "a_kreds": "een kring", "a_friend": "Een vriend" },
  "no": { "post_kreds": "{n} delte et innlegg i «{k}»", "post": "{n} delte et innlegg", "like": "{n} likte innlegget ditt", "comment": "{n} svarte på innlegget ditt", "comment_like": "{n} likte kommentaren din", "reply": "{n} svarte på kommentaren din", "friend_request": "{n} sendte deg en venneforespørsel", "friend_now": "{n} er nå vennen din", "invite": "{n} har invitert deg til «{k}»", "kreq": "{n} vil være med i «{k}»", "mention": "{n} nevnte deg", "chat_dm": "{n} sendte deg en melding", "chat_kreds": "{n} skrev i «{k}»", "admitted": "Du er tatt opp i «{k}» 🎉", "rejected": "Opptaket ditt i «{k}» gikk ikke gjennom", "someone": "Noen", "the_kreds": "kretsen", "a_kreds": "en krets", "a_friend": "En venn" },
  "pl": { "post_kreds": "{n} opublikował(a) post w „{k}”", "post": "{n} udostępnił(a) post", "like": "{n} polubił(a) twój post", "comment": "{n} odpowiedział(a) na twój post", "comment_like": "{n} polubił(a) twój komentarz", "reply": "{n} odpowiedział(a) na twój komentarz", "friend_request": "{n} wysłał(a) ci zaproszenie do znajomych", "friend_now": "{n} jest teraz twoim znajomym", "invite": "{n} zaprosił(a) cię do „{k}”", "kreq": "{n} chce dołączyć do „{k}”", "mention": "{n} wspomniał(a) o tobie", "chat_dm": "{n} wysłał(a) ci wiadomość", "chat_kreds": "{n} napisał(a) w „{k}”", "admitted": "Zostałeś przyjęty do „{k}” 🎉", "rejected": "Twoje przyjęcie do „{k}” nie zostało zatwierdzone", "someone": "Ktoś", "the_kreds": "krąg", "a_kreds": "krąg", "a_friend": "Znajomy" },
  "pt": { "post_kreds": "{n} partilhou uma publicação em \"{k}\"", "post": "{n} partilhou uma publicação", "like": "{n} gostou da tua publicação", "comment": "{n} respondeu à tua publicação", "comment_like": "{n} gostou do teu comentário", "reply": "{n} respondeu ao teu comentário", "friend_request": "{n} enviou-te um pedido de amizade", "friend_now": "{n} está agora no teu círculo", "invite": "{n} convidou-te para \"{k}\"", "kreq": "{n} quer entrar em \"{k}\"", "mention": "{n} mencionou-te", "chat_dm": "{n} enviou-te uma mensagem", "chat_kreds": "{n} escreveu em \"{k}\"", "admitted": "Já fazes parte de \"{k}\" 🎉", "rejected": "A tua entrada em \"{k}\" não foi aprovada", "someone": "Alguém", "the_kreds": "o círculo", "a_kreds": "um círculo", "a_friend": "Um amigo" },
  "ro": { "post_kreds": "{n} a distribuit o postare în „{k}”", "post": "{n} a distribuit o postare", "like": "{n} ți-a apreciat postarea", "comment": "{n} a răspuns la postarea ta", "comment_like": "{n} ți-a apreciat comentariul", "reply": "{n} a răspuns la comentariul tău", "friend_request": "{n} ți-a trimis o cerere de prietenie", "friend_now": "{n} e acum prietenul tău", "invite": "{n} te-a invitat în „{k}”", "kreq": "{n} vrea să intre în „{k}”", "mention": "{n} te-a menționat", "chat_dm": "{n} ți-a trimis un mesaj", "chat_kreds": "{n} a scris în „{k}”", "admitted": "Ai fost primit în „{k}” 🎉", "rejected": "Primirea ta în „{k}” nu a fost aprobată", "someone": "Cineva", "the_kreds": "cercul", "a_kreds": "un cerc", "a_friend": "Un prieten" },
  "ru": { "post_kreds": "{n} поделился(-ась) постом в «{k}»", "post": "{n} поделился(-ась) постом", "like": "{n} лайкнул(а) твой пост", "comment": "{n} ответил(а) на твой пост", "comment_like": "{n} лайкнул(а) твой комментарий", "reply": "{n} ответил(а) на твой комментарий", "friend_request": "{n} отправил(а) тебе запрос в друзья", "friend_now": "{n} теперь твой друг", "invite": "{n} пригласил(а) тебя в «{k}»", "kreq": "{n} хочет вступить в «{k}»", "mention": "{n} упомянул(а) тебя", "chat_dm": "{n} отправил(а) тебе сообщение", "chat_kreds": "{n} написал(а) в «{k}»", "admitted": "Ты теперь в «{k}» 🎉", "rejected": "Твоё вступление в «{k}» не прошло", "someone": "Кто-то", "the_kreds": "круг", "a_kreds": "круг", "a_friend": "Друг" },
  "sv": { "post_kreds": "{n} delade ett inlägg i ”{k}”", "post": "{n} delade ett inlägg", "like": "{n} gillade ditt inlägg", "comment": "{n} svarade på ditt inlägg", "comment_like": "{n} gillade din kommentar", "reply": "{n} svarade på din kommentar", "friend_request": "{n} skickade en vänförfrågan", "friend_now": "{n} är nu din vän", "invite": "{n} har bjudit in dig till ”{k}”", "kreq": "{n} vill vara med i ”{k}”", "mention": "{n} nämnde dig", "chat_dm": "{n} skickade ett meddelande", "chat_kreds": "{n} skrev i ”{k}”", "admitted": "Du är nu med i ”{k}” 🎉", "rejected": "Din ansökan till ”{k}” gick inte igenom", "someone": "Någon", "the_kreds": "kretsen", "a_kreds": "en krets", "a_friend": "En vän" },
  "th": { "post_kreds": "{n} แชร์โพสต์ใน \"{k}\"", "post": "{n} แชร์โพสต์", "like": "{n} ไลก์โพสต์ของคุณ", "comment": "{n} ตอบโพสต์ของคุณ", "comment_like": "{n} ไลก์ความคิดเห็นของคุณ", "reply": "{n} ตอบความคิดเห็นของคุณ", "friend_request": "{n} ส่งคำขอเป็นเพื่อนถึงคุณ", "friend_now": "{n} อยู่ในวงของคุณแล้ว", "invite": "{n} เชิญคุณเข้า \"{k}\"", "kreq": "{n} อยากเข้าร่วม \"{k}\"", "mention": "{n} พูดถึงคุณ", "chat_dm": "{n} ส่งข้อความถึงคุณ", "chat_kreds": "{n} เขียนใน \"{k}\"", "admitted": "คุณได้รับเข้า \"{k}\" แล้ว 🎉", "rejected": "การรับคุณเข้า \"{k}\" ไม่ผ่าน", "someone": "ใครบางคน", "the_kreds": "วง", "a_kreds": "วงหนึ่ง", "a_friend": "เพื่อนคนหนึ่ง" },
  "tl": { "post_kreds": "Nagbahagi ng post si {n} sa \"{k}\"", "post": "Nagbahagi ng post si {n}", "like": "Nag-like si {n} sa post mo", "comment": "Sumagot si {n} sa post mo", "comment_like": "Nag-like si {n} sa komento mo", "reply": "Sumagot si {n} sa komento mo", "friend_request": "Nagpadala sa iyo si {n} ng friend request", "friend_now": "Kaibigan mo na si {n}", "invite": "Inimbitahan ka ni {n} sa \"{k}\"", "kreq": "Gustong sumali ni {n} sa \"{k}\"", "mention": "Binanggit ka ni {n}", "chat_dm": "Nagpadala sa iyo ng mensahe si {n}", "chat_kreds": "Sumulat si {n} sa \"{k}\"", "admitted": "Kasali ka na sa \"{k}\" 🎉", "rejected": "Hindi pumasa ang iyong pagsali sa \"{k}\"", "someone": "May isang tao", "the_kreds": "ang circle", "a_kreds": "isang circle", "a_friend": "Isang kaibigan" },
  "tr": { "post_kreds": "{n}, \"{k}\" çemberinde bir gönderi paylaştı", "post": "{n} bir gönderi paylaştı", "like": "{n} gönderini beğendi", "comment": "{n} gönderine yanıt verdi", "comment_like": "{n} yorumunu beğendi", "reply": "{n} yorumuna yanıt verdi", "friend_request": "{n} sana bir arkadaşlık isteği gönderdi", "friend_now": "{n} artık arkadaşın", "invite": "{n} seni \"{k}\" çemberine davet etti", "kreq": "{n}, \"{k}\" çemberine katılmak istiyor", "mention": "{n} senden bahsetti", "chat_dm": "{n} sana bir mesaj gönderdi", "chat_kreds": "{n}, \"{k}\" çemberinde yazdı", "admitted": "\"{k}\" çemberine kabul edildin 🎉", "rejected": "\"{k}\" çemberine kabulün onaylanmadı", "someone": "Birisi", "the_kreds": "çember", "a_kreds": "bir çember", "a_friend": "Bir arkadaş" },
  "uk": { "post_kreds": "{n} поділився(-лася) дописом у «{k}»", "post": "{n} поділився(-лася) дописом", "like": "{n} вподобав(-ла) твій допис", "comment": "{n} відповів(-ла) на твій допис", "comment_like": "{n} вподобав(-ла) твій коментар", "reply": "{n} відповів(-ла) на твій коментар", "friend_request": "{n} надіслав(-ла) тобі запит на дружбу", "friend_now": "{n} тепер у твоєму колі", "invite": "{n} запросив(-ла) тебе до «{k}»", "kreq": "{n} хоче приєднатися до «{k}»", "mention": "{n} згадав(-ла) тебе", "chat_dm": "{n} надіслав(-ла) тобі повідомлення", "chat_kreds": "{n} написав(-ла) у «{k}»", "admitted": "Тебе прийнято до «{k}» 🎉", "rejected": "Твій вступ до «{k}» не пройшов", "someone": "Хтось", "the_kreds": "коло", "a_kreds": "коло", "a_friend": "Друг" },
  "vi": { "post_kreds": "{n} đã chia sẻ một bài đăng trong \"{k}\"", "post": "{n} đã chia sẻ một bài đăng", "like": "{n} đã thích bài đăng của bạn", "comment": "{n} đã trả lời bài đăng của bạn", "comment_like": "{n} đã thích bình luận của bạn", "reply": "{n} đã trả lời bình luận của bạn", "friend_request": "{n} đã gửi cho bạn lời mời kết bạn", "friend_now": "{n} giờ đã là bạn của bạn", "invite": "{n} đã mời bạn vào \"{k}\"", "kreq": "{n} muốn tham gia \"{k}\"", "mention": "{n} đã nhắc đến bạn", "chat_dm": "{n} đã gửi cho bạn một tin nhắn", "chat_kreds": "{n} đã viết trong \"{k}\"", "admitted": "Bạn đã được nhận vào \"{k}\" 🎉", "rejected": "Việc nhận bạn vào \"{k}\" không được thông qua", "someone": "Ai đó", "the_kreds": "vòng tròn", "a_kreds": "một vòng tròn", "a_friend": "Một người bạn" },
  "zh-hans": { "post_kreds": "{n} 在「{k}」发了帖子", "post": "{n} 分享了一条帖子", "like": "{n} 赞了你的帖子", "comment": "{n} 回复了你的帖子", "comment_like": "{n} 赞了你的评论", "reply": "{n} 回复了你的评论", "friend_request": "{n} 向你发送了好友请求", "friend_now": "{n} 成为了你的朋友", "invite": "{n} 邀请你加入「{k}」", "kreq": "{n} 想加入「{k}」", "mention": "{n} 提到了你", "chat_dm": "{n} 给你发了一条消息", "chat_kreds": "{n} 在「{k}」发言", "admitted": "你已加入「{k}」🎉", "rejected": "你加入「{k}」的申请没有通过", "someone": "有人", "the_kreds": "该圈子", "a_kreds": "一个圈子", "a_friend": "一位朋友" },
  "zh-hant": { "post_kreds": "{n} 在「{k}」發了一則貼文", "post": "{n} 發了一則貼文", "like": "{n} 對你的貼文按了讚", "comment": "{n} 回覆了你的貼文", "comment_like": "{n} 對你的留言按了讚", "reply": "{n} 回覆了你的留言", "friend_request": "{n} 向你送出了好友邀請", "friend_now": "{n} 成了你的朋友", "invite": "{n} 邀請你加入「{k}」", "kreq": "{n} 想加入「{k}」", "mention": "{n} 提到了你", "chat_dm": "{n} 傳了一則訊息給你", "chat_kreds": "{n} 在「{k}」發言", "admitted": "你已加入「{k}」🎉", "rejected": "你加入「{k}」的申請沒有通過", "someone": "某人", "the_kreds": "圈子", "a_kreds": "一個圈子", "a_friend": "一位朋友" },
};

function tmpl(lang: string, key: string): string {
  const d = T[lang] || T.en;
  return d[key] ?? T.en[key] ?? "";
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

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method_not_allowed", { status: 405 });
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
  if (!Deno.env.get("APNS_KEY")) return new Response(JSON.stringify({ error: "apns_not_configured" }), { status: 200 });

  const host = (Deno.env.get("APNS_HOST") ?? "api.push.apple.com")
    .trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").trim();
  const topic = Deno.env.get("APNS_BUNDLE_ID") ?? "dk.vibefeed.app";
  const jwt = await apnsJwt();
  const extra: Record<string, unknown> = { kind };
  if (body.pid != null) extra.pid = body.pid;
  if (body.fid != null) extra.fid = body.fid;
  if (body.cid != null) extra.cid = body.cid;
  let sent = 0;
  const errors: string[] = [];
  await Promise.all((rows as any[]).map(async (r) => {
    // r.push_lang = brugerens valgte sprog. Kendt kode → egne skabeloner, ukendt → engelsk,
    // manglende (legacy-rækker) → dansk. tmpl() falder desuden pr. nøgle tilbage til engelsk.
    const lang = (r.push_lang && T[r.push_lang]) ? r.push_lang : (r.push_lang ? "en" : "da");
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
    // Chat i Messenger-stil: titlen bærer personen (+ kredsen), brødteksten er SELVE beskeden.
    if (kind === "chat" && body.msg) {
      title = body.kreds ? `${actor} · ${body.kreds}` : actor;
      text = String(body.msg);
    }
    if (!text) return;
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
