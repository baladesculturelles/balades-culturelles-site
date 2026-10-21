/* BALADES_CULTURELLES_MOTEUR */

/**
 * Balades Culturelles — moteur de réservation (Google Apps Script).
 *
 * Le site public envoie chaque réservation à ce script, qui la range
 * automatiquement dans votre Google Drive :
 *
 *   📁 Balades Culturelles — Réservations
 *      📊 Tableau de bord des réservations   ← toutes les dates, places restantes, liens
 *      📁 2026-11 · Novembre 2026
 *         📊 2026-11-14 · Le Paris de Molière · 10 h 30–12 h   ← participants de la date
 *
 * Le programme (dates, tarifs, nombre de places) est lu directement sur le site
 * publié (programme.json), toutes les 15 minutes : quand vous modifiez le site,
 * il n’y a rien à recopier ici.
 *
 * La fiche d’une date est créée à sa première réservation. C’est dans cette fiche
 * que vous suivez vos participants (colonne « Étape ») ; le tableau de bord se met
 * à jour à chaque réservation et toutes les 15 minutes.
 *
 * Chaque réservation confirmée envoie un e-mail au client depuis votre boîte, sans copie ;
 * un récapitulatif quotidien séparé pour vous (autorisation « script.send_mail »).
 *
 * Mise en route : exécutez une fois la fonction « installer », puis déployez le
 * projet en application Web (voir README.md).
 */

// Adresse publique du site. C’est le seul réglage à changer si le site déménage :
// le programme lu par le moteur, les liens des e-mails de confirmation, la
// description des événements d’agenda et le tableau de bord en découlent.
// Pour la changer sans toucher au code :
// Paramètres du projet → Propriétés du script → SITE_URL
// (adresse complète, terminée ou non par « / », par exemple https://baladesculturelles.fr).
const SITE_URL = "https://baladesculturelles.github.io/balades-culturelles-site/";
// Adresse du programme publié avec le site. Pour la changer sans toucher au code :
// Paramètres du projet → Propriétés du script → PROGRAMME_URL.
const PROGRAMME_URL = `${SITE_URL}programme.json`;
const TIME_ZONE = "Europe/Paris";
const ROOT_FOLDER_NAME = "Balades Culturelles — Réservations";
const DASHBOARD_NAME = "Tableau de bord des réservations";
const DASHBOARD_SHEET = "Tableau de bord";
const JOURNAL_SHEET = "Journal des réservations";
const VISIT_SHEET = "Participants";
const SYNC_EVERY_MINUTES = 15;
const REMOVED_KEEP_DAYS = 30;
const PROGRAM_CHUNK_CHARS = 8000;

const ENGINE_API = 1;
const ENGINE_VERSION = "2b438739fd";

/* ------------------------------------------------------------------ */
/* E-mail de confirmation                                             */
/* ------------------------------------------------------------------ */

// Boîte de Marie-Tiyi : les confirmations partent de cette adresse et le client
// y répond directement. Pour la changer sans toucher au code :
// Paramètres du projet → Propriétés du script → CONTACT_EMAIL.
const CONTACT_EMAIL = "balades.culturelles@gmail.com";
const CONTACT_NAME = "Marie-Tiyi — Balades Culturelles";

// Numéro professionnel de la guide, affiché dans la signature des confirmations
// (texte simple et version HTML cliquable). Distinct des téléphones des clients.
// Pour le changer sans toucher au code :
// Paramètres du projet → Propriétés du script → GUIDE_PHONE.
const GUIDE_PHONE = "06 01 74 04 49";

// Case (fusionnée) où vous notez le point de rendez-vous dans la fiche d’une date.
const MEETING_CELL = "B4";
const MEETING_FALLBACK = "Le lieu de rendez-vous précis vous sera communiqué quelques jours avant la balade.";

// Balades dont le titre évoque un quartier : la formule de politesse parle alors
// du quartier. Pour les autres (cimetière, monuments, thème…), une variante neutre est utilisée.
const QUARTIER_WORDS = Object.freeze(["quartier", "village", "faubourg"]);

// Valeurs de secours tant que le programme du site n’a pas été lu.
const DEFAULT_CAPACITY = 25;
const GROUP_CAPACITY = 20; // groupes de seniors et visites en famille
const CUSTOM_CAPACITY = 100;
const SMALL_GROUP_TOPICS = Object.freeze([
  "Je souhaite organiser une visite pour un groupe de seniors",
  "Je souhaite organiser une sortie pour une famille",
]);
const DEFAULT_PRICES = Object.freeze({ standard: 15, youth: 10, child: 8, underFive: 0 });
const PRICE_KEYS = Object.freeze(["standard", "youth", "child", "underFive"]);
// Un enfant (5–14 ans) ou un moins de 5 ans ne peut pas réserver seul : la
// demande doit comporter au moins un accompagnant de 15 ans ou plus.
const COMPANION_KEYS = Object.freeze(["standard", "youth"]);
const CHILD_ALONE_MESSAGE = "Un enfant ou un moins de 5 ans ne peut pas s’inscrire seul : ajoutez au moins un accompagnant de 15 ans ou plus (plein tarif ou tarif 15–25 ans).";

// Étapes de suivi d’une réservation. Seule « Annulée » libère les places.
const STATUSES = Object.freeze(["Confirmée", "Contactée", "Réalisée", "Annulée"]);
const TO_CONTACT = "Confirmée";
const CANCELLED = "Annulée";
const REMOVED_STATE = "Retirée du site";

const MONTHS = Object.freeze(["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]);
const WEEKDAYS = Object.freeze(["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"]);
const COLORS = Object.freeze({ forest: "#183e30", clay: "#b7654b", muted: "#686d62", paper: "#f3efe5", white: "#ffffff" });

// Fiche d’une date : en-tête sur les lignes 1 à 4, titres de colonnes en ligne 6, participants dès la ligne 7.
// Les colonnes ajoutées après « Vos notes » (prénom, suivi des paiements) ne décalent
// aucune colonne existante : les anciennes fiches gardent leurs données intactes.
const VISIT_HEADER_ROW = 6;
const VISIT_FIRST_ROW = 7;
const VISIT_HEADERS = Object.freeze([
  "Référence", "Nom", "E-mail", "Téléphone", "Personnes",
  "Plein tarif (26 ans et +)", "Jeunes 15–25 ans", "Enfants 5–14 ans", "Moins de 5 ans",
  "Montant estimé (€)", "Étape", "Réservée le", "Message du client", "Vos notes",
  "Prénom", "Paiement", "Montant encaissé (€)", "Date du paiement", "Moyen de paiement",
  "2e versement (€)", "Date du 2e paiement", "Moyen du 2e versement", "Total encaissé (€)",
  "Remboursement (€)", "Date du remboursement", "Moyen du remboursement",
]);
// Numéros de colonnes (1 = A) des champs utilisés par le code.
const VISIT_COL = Object.freeze({
  people: 5, status: 11, createdAt: 12, estimated: 10, notes: 14,
  firstName: 15, payment: 16, amount: 17, payDate: 18, payMethod: 19,
  amount2: 20, payDate2: 21, payMethod2: 22, total: 23,
  refund: 24, refundDate: 25, refundMethod: 26,
});

// États possibles de la colonne « Paiement ». « Payé » remplit les champs vides
// (montant estimé et date de la balade) ; « Partiel » et « Remboursé » renvoient
// au journal des versements de la fiche.
const PAYMENT_STATUSES = Object.freeze(["Non payé", "Payé", "Partiel", "Remboursé"]);
const PAYMENT_METHODS = Object.freeze(["Espèces", "Carte", "Virement", "Chèque"]);

// Tableau de bord : titre et résumé sur les lignes 1 à 3, titres de colonnes en ligne 5.
const DASHBOARD_HEADER_ROW = 5;
const DASHBOARD_FIRST_ROW = 6;
const DASHBOARD_HEADERS = Object.freeze([
  "Date", "Balade", "Horaire", "Réservations", "Personnes", "Places restantes", "État", "À contacter", "Fiche de la date",
]);
const JOURNAL_HEADERS = Object.freeze([
  "Réservée le", "Date de la balade", "Balade", "Horaire", "Référence", "Nom", "E-mail", "Téléphone",
  "Personnes", "Montant estimé (€)", "Fiche de la date", "Message du client", "Prénom", "Échec e-mail", "Clé d’idempotence",
]);
const JOURNAL_EMAIL_FAILURE_COLUMN = 14;
const JOURNAL_IDEMPOTENCY_COLUMN = 15;

/* ------------------------------------------------------------------ */
/* Google Agenda (facultatif)                                         */
/* ------------------------------------------------------------------ */

// Un événement par date ayant au moins un participant : titre, horaire, lieu de
// rendez-vous (case B4 de la fiche) et places restantes. Aucune donnée client
// nominative n’est recopiée dans l’agenda : seulement des compteurs et des liens.
// Réglages : CALENDAR_ID (agenda cible, par défaut l’agenda principal) et
// CALENDAR_DISABLED=1 pour tout désactiver. Rien n’est envoyé aux participants.

function calendarId_() {
  return props_().getProperty("CALENDAR_ID") || "";
}

function calendar_() {
  const id = calendarId_();
  if (id) {
    const named = CalendarApp.getCalendarById(id);
    if (named) return named;
    throw new Error(`Agenda introuvable (CALENDAR_ID=${id}).`);
  }
  return CalendarApp.getDefaultCalendar();
}

/** Traitement protégé : un souci d’agenda ne doit jamais bloquer une réservation. */
function syncCalendarSafely_(onlySessionId) {
  try {
    const store = props_();
    if (store.getProperty("CALENDAR_DISABLED") === "1") return;
    const key = "calendar:run";
    const started = Number(store.getProperty(key) || 0);
    if (started && Date.now() - started < 300000) {
      console.warn("Agenda : un traitement est déjà en cours.");
      return;
    }
    store.setProperty(key, String(Date.now()));
    try {
      runCalendar_(onlySessionId);
    } finally {
      store.deleteProperty(key);
    }
  } catch (error) {
    console.error("Agenda non mis à jour : " + error);
  }
}

function runCalendar_(onlySessionId) {
  const program = getProgram_();
  if (!program.loaded) return; // sans programme, on ne touche à rien
  const store = props_();
  const stored = store.getProperties();
  const sessions = onlySessionId
    ? program.sessions.filter((session) => session.id === onlySessionId)
    : program.sessions;
  const known = {};
  sessions.forEach((session) => {
    known[propertyKey_("", session.id)] = true;
    syncCalendarEvent_(session);
  });
  if (onlySessionId) return;
  // Dates retirées du site : leur événement est conservé s’il reste des participants,
  // sinon il est supprimé. Rien n’est jamais supprimé du calendrier d’une balade remplie.
  Object.keys(stored).forEach((key) => {
    if (key.indexOf("calendar:") !== 0) return;
    const hash = key.slice("calendar:".length);
    if (known[hash]) return;
    const record = parseVisit_(stored["visit:" + hash]);
    const stats = parseStats_(stored["stats:" + hash]);
    if (record && stats.booked > 0) {
      syncCalendarEvent_({ id: record.id, date: record.date, walk: record.walk, slot: record.slot, removed: true });
    } else {
      removeCalendarEvent_(key);
    }
  });
}

// Dates ajoutées (ou déplacées) directement dans l’agenda : elles complètent le
// programme du site, sans le remplacer. Lecture mise en cache le temps d’une exécution.
let agendaSessionsCache_ = null;

function agendaTitle_(walk, removed) {
  return `Balade : ${walk}${removed ? " (retirée du site)" : ""}`;
}

function slotLabel_(start, end) {
  const read = (date) => {
    const parts = Utilities.formatDate(date, TIME_ZONE, "HH:mm").split(":");
    const hour = Number(parts[0]);
    const minute = Number(parts[1]);
    return minute ? `${hour} h ${minute}` : `${hour} h`;
  };
  return `${read(start)}–${read(end)}`;
}

/** Événements « Balade : … » de l’agenda, convertis en dates du programme. */
function agendaSessions_() {
  if (agendaSessionsCache_) return agendaSessionsCache_;
  const result = { ready: false, sessions: [] };
  try {
    if (props_().getProperty("CALENDAR_DISABLED") === "1") {
      agendaSessionsCache_ = result;
      return result;
    }
    const calendar = calendar_();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    // La veille comprise : une date terminée hier à 12 h reste affichée jusqu’à aujourd’hui 12 h.
    start.setDate(start.getDate() - 1);
    const end = new Date(start.getTime() + 401 * 86400000);
    const seen = {};
    calendar.getEvents(start, end).forEach((event) => {
      const title = String(event.getTitle() || "").trim();
      const match = /^Balade\s*:\s*(.+?)\s*(?:\((?:retirée du site|annulée)\))?$/i.exec(title);
      if (!match) return;
      const walk = match[1].trim();
      if (!isLabel_(walk, 200)) return;
      const from = event.getStartTime();
      const to = event.getEndTime();
      if (!from || !to) return;
      // Au-delà de 24 h après la fin, la date quitte le site même si l’événement reste dans l’agenda.
      if (Date.now() > to.getTime() + VISIBLE_HOURS_AFTER_END * 3600000) return;
      const date = Utilities.formatDate(from, TIME_ZONE, "yyyy-MM-dd");
      const slot = slotLabel_(from, to);
      const id = `${date}|${walk}|${slot}`;
      if (seen[id]) return;
      seen[id] = true;
      result.sessions.push({ id: id, date: date, walk: walk, slot: slot });
    });
    result.sessions.sort((a, b) => compare_(a.date, b.date) || compare_(a.walk, b.walk) || compare_(a.slot, b.slot));
    // Une agenda vide ne doit jamais vider le programme du site.
    result.ready = result.sessions.length > 0;
  } catch (error) {
    console.warn("Agenda non lisible : " + error);
  }
  agendaSessionsCache_ = result;
  return result;
}

/** Ajoute au programme les dates présentes dans l’agenda mais pas sur le site. */
function sessionsWithAgenda_(sessions) {
  const agenda = agendaSessions_();
  if (!agenda.sessions.length) return sessions;
  const known = {};
  sessions.forEach((session) => { known[`${session.date}|${session.walk}`] = true; });
  const extra = agenda.sessions.filter((session) => !known[`${session.date}|${session.walk}`]);
  if (!extra.length) return sessions;
  return sessions.concat(extra)
    .sort((a, b) => compare_(a.date, b.date) || compare_(a.walk, b.walk) || compare_(a.slot, b.slot));
}

function parseCalendarRecord_(value) {
  if (!value) return null;
  try {
    const record = JSON.parse(value);
    if (!record || !record.e) return null;
    return { id: String(record.e), signature: String(record.sig || ""), date: String(record.d || ""), walk: String(record.w || ""), slot: String(record.s || "") };
  } catch (error) {
    return null;
  }
}

/** Crée, met à jour ou supprime l’événement d’une date, sans appel inutile. */
function syncCalendarEvent_(session) {
  const store = props_();
  const hash = propertyKey_("", session.id);
  const key = "calendar:" + hash;
  const stats = parseStats_(store.getProperty("stats:" + hash));
  const booked = stats.booked || 0;
  const existing = parseCalendarRecord_(store.getProperty(key));
  if (!booked) {
    if (existing) removeCalendarEvent_(key);
    return;
  }
  const record = parseVisit_(store.getProperty("visit:" + hash));
  const visit = record && openIfAlive_(record.fileId);
  const meeting = visit ? meetingPlace_(visitSheet_(visit)) : "";
  const removed = Boolean(session.removed);
  const remaining = Math.max(0, sessionCapacity_(session) - booked);
  const signature = [booked, stats.bookings, session.walk, session.slot, meeting, remaining, removed ? "R" : "", session.date].join("|");
  // Vérification régulière des dates proches : un événement supprimé à la main est recréé.
  const soon = session.date <= isoDaysAhead_(7);
  if (existing && existing.signature === signature && !soon) return;

  const calendar = calendar_();
  let event = null;
  if (existing) {
    try {
      event = calendar.getEventById(existing.id);
    } catch (error) {
      event = null;
    }
  }
  const title = agendaTitle_(session.walk, removed);
  const start = sessionStartDate_(session);
  const end = sessionEndDate_(session);
  const description = calendarDescription_(session, stats, visit, remaining);
  // Événement déjà créé à la main (ou semé depuis le site) : on le reprend au lieu
  // d’en créer un second.
  if (!event) {
    try {
      const day = parseIsoDate_(session.date);
      const from = new Date(day.year, day.month - 1, day.day, 0, 0, 0);
      const to = new Date(day.year, day.month - 1, day.day + 1, 0, 0, 0);
      event = calendar.getEvents(from, to)
        .filter((candidate) => String(candidate.getTitle() || "").trim() === title)[0] || null;
    } catch (error) {
      event = null;
    }
  }
  if (event) {
    event.setTitle(title);
    event.setTime(start, end);
    event.setLocation(meeting);
    event.setDescription(description);
  } else {
    event = calendar.createEvent(title, start, end, { description: description, location: meeting });
  }
  store.setProperty(key, JSON.stringify({
    e: event.getId(), sig: signature, d: session.date, w: session.walk, s: session.slot,
  }));
}

function calendarDescription_(session, stats, visit, remaining) {
  const capacity = sessionCapacity_(session);
  const lines = [
    `${stats.booked} place(s) réservée(s) · ${remaining} restante(s) sur ${capacity}`,
    `Horaire : ${session.slot}`,
  ];
  const meeting = visit ? meetingPlace_(visitSheet_(visit)) : "";
  lines.push(`Lieu de rendez-vous : ${meeting || "à préciser dans la fiche"}`);
  if (visit) lines.push("", `Fiche de la date : ${visit.getUrl()}`);
  const dashboard = openIfAlive_(props_().getProperty("DASHBOARD_ID"));
  if (dashboard) lines.push(`Tableau de bord : ${dashboard.getUrl()}`);
  lines.push("", `Événement créé et mis à jour automatiquement par le site Balades Culturelles : ${siteUrl_()}`);
  return lines.join("\n");
}

function removeCalendarEvent_(key) {
  const store = props_();
  const existing = parseCalendarRecord_(store.getProperty(key));
  if (!existing) {
    store.deleteProperty(key);
    return;
  }
  try {
    const event = calendar_().getEventById(existing.id);
    if (event) event.deleteEvent();
  } catch (error) {
    console.warn("Événement d’agenda introuvable (déjà supprimé ?) : " + error);
  }
  store.deleteProperty(key);
}

/* ------------------------------------------------------------------ */
/* Comptabilité (tableur privé, jamais publié)                        */
/* ------------------------------------------------------------------ */

// Nom du tableur privé de suivi des encaissements, rangé dans le dossier des réservations.
const ACCOUNTING_NAME = "Comptabilité — Balades Culturelles";
const ACCOUNTING_MOVEMENTS = "Mouvements";
const ACCOUNTING_SUMMARY = "Synthèse mensuelle";
const ACCOUNTING_UNPAID = "Impayés";
const ACCOUNTING_FILES = "Fiches suivies";
const ACCOUNTING_ALERTS = "À vérifier";

// Un mouvement = une somme encaissée (ou remboursée) datée et rattachée à une réservation.
const MOVEMENT_HEADERS = Object.freeze([
  "Référence de réservation", "Balade", "Date de la balade", "Client", "Prénom", "Nom",
  "Date du paiement", "Type de mouvement", "Montant (€)", "Moyen de paiement",
  "Statut", "Identifiant", "Fiche de la visite",
]);
const MOVEMENT_TYPES = Object.freeze(["Encaissement", "Remboursement"]);
const MOVEMENT_ACTIVE = "Actif";
const MOVEMENT_CANCELLED = "Annulé";
const SUMMARY_HEADERS = Object.freeze(["Mois", "Total encaissé (€)", "Remboursements (€)", "Solde de suivi (€)"]);
const UNPAID_HEADERS = Object.freeze([
  "Référence", "Client", "Balade", "Date de la balade", "Montant estimé (€)",
  "Montant encaissé (€)", "Reste à encaisser (€)", "Statut",
]);
const FILES_HEADERS = Object.freeze([
  "Identifiant de la fiche", "Date de la balade", "Balade", "Horaire", "Dernière lecture", "État",
]);
const ALERT_HEADERS = Object.freeze([
  "Signalement", "Fiche / référence", "Détail", "Date du signalement", "État",
]);
const ALERT_OPEN = "À vérifier";
const ALERT_CLOSED = "Réglé";

/* ------------------------------------------------------------------ */
/* Carnet d’adresses (tableur privé, jamais publié)                   */
/* ------------------------------------------------------------------ */

// Un contact = une personne (ou un foyer) identifié par son e-mail ou son téléphone.
// Le carnet est reconstruit à partir des fiches de dates et du journal : une personne
// déjà présente n’est jamais ajoutée deux fois, seules ses visites sont mises à jour.
const CONTACTS_NAME = "Carnet d’adresses — Balades Culturelles";
const CONTACTS_SHEET = "Carnet d’adresses";
const CONTACTS_TITLE_ROW = 1;
const CONTACTS_SUMMARY_ROW = 2;
const CONTACTS_HEADER_ROW = 4;
const CONTACTS_FIRST_ROW = 5;
const CONTACT_HEADERS = Object.freeze([
  "Clé", "Prénom", "Nom", "E-mail", "Autres e-mails", "Téléphone", "Autres téléphones",
  "Première visite", "Dernière visite", "Visites", "Personnes", "Balades",
  "Dernière balade", "Étape", "Ajouté au carnet", "Ne pas contacter", "Vos notes",
]);
const CONTACT_COL = Object.freeze({
  key: 1, firstName: 2, lastName: 3, email: 4, altEmails: 5, phone: 6, altPhones: 7,
  firstVisit: 8, lastVisit: 9, visits: 10, people: 11, walks: 12, lastWalk: 13,
  stage: 14, addedAt: 15, optOut: 16, notes: 17,
});

// Programme lu pendant l’exécution en cours (chaque appel au script repart de zéro).
let programCache_ = null;

/* ------------------------------------------------------------------ */
/* Fonctions à lancer depuis l’éditeur                                */
/* ------------------------------------------------------------------ */

/**
 * À exécuter une fois (bouton « Exécuter ») : lit le programme du site, crée le dossier
 * et le tableau de bord dans votre Drive et programme la mise à jour automatique
 * toutes les 15 minutes. Vous pouvez la relancer sans risque : rien n’est créé en double.
 */
function installer() {
  programCache_ = null;
  const fetched = refreshProgram_();
  withLock_(30000, () => {
    const root = getRootFolder_();
    const dashboard = getDashboard_(root);
    setupDashboard_(dashboard);
    installSyncTrigger_();
    pruneProperties_();
    relinkVisitFiles_(root);
    refreshUpcomingStats_();
    writeDashboard_(dashboard);
  });
  // Le carnet d’adresses est créé dès l’installation (même vide) : il se remplit
  // ensuite tout seul à chaque réservation.
  runContactsSafely_();
  syncCalendarSafely_();
  const program = getProgram_();
  const opening = `C’est prêt : ouvrez le dossier « ${ROOT_FOLDER_NAME} » dans votre Google Drive.`;
  const message = program.loaded
    ? `${opening} Programme lu sur le site : ${baseProgram_().sessions.length} dates.`
    : `${opening} Le programme n’a pas encore pu être lu sur le site (${fetched.reason}) ; il le sera automatiquement dès sa publication.`;
  console.log(message);
  return message;
}

/**
 * Relit le programme du site et les fiches des dates à venir, puis met à jour le
 * tableau de bord et les places affichées sur le site. Lancée automatiquement toutes
 * les 15 minutes ; vous pouvez aussi l’exécuter à la main pour appliquer tout de suite
 * une annulation ou une modification du site.
 */
function synchroniser() {
  programCache_ = null;
  const fetched = refreshProgram_();
  const done = withLock_(10000, () => {
    pruneProperties_();
    refreshUpcomingStats_();
    const dashboard = getDashboard_(getRootFolder_());
    writeDashboard_(dashboard);
    sendDailySummary_(dashboard);
    sendVisitReports_();
    return true;
  }, { optional: true });
  // Comptabilité et carnet d’adresses : tâches indépendantes, protégées par leur
  // propre verrou. Une difficulté n’empêche ni les réservations ni les e-mails.
  runAccountingSafely_();
  runContactsSafely_();
  syncCalendarSafely_();
  if (!done) return "Une réservation était en cours : nouvelle mise à jour au prochain passage.";
  return fetched.ok
    ? `Tableau de bord à jour (${baseProgram_().sessions.length} dates lues sur le site).`
    : "Tableau de bord à jour (programme du site momentanément illisible : la dernière version est conservée).";
}

/* ------------------------------------------------------------------ */
/* Points d’entrée du site public                                     */
/* ------------------------------------------------------------------ */

function doGet(e) {
  programCache_ = null;
  // Le site lit les places restantes via ?api=availability.
  if (e && e.parameter && e.parameter.api === "availability") {
    try {
      return jsonOutput_(getAvailability_());
    } catch (error) {
      console.error(error);
      return jsonOutput_({ error: "availability_unavailable", message: "Les disponibilités sont momentanément indisponibles." });
    }
  }
  // Le site complète ses dates avec celles de l’agenda (?api=schedule).
  if (e && e.parameter && e.parameter.api === "schedule") {
    const agenda = agendaSessions_();
    return jsonOutput_({
      ok: true,
      agenda: agenda.ready,
      sessions: agenda.sessions.map((session) => ({ date: session.date, walk: session.walk, slot: session.slot })),
    });
  }
  return jsonOutput_({ ok: true, service: "Balades Culturelles — réservations", message: "Ce service reçoit les réservations du site." });
}

/**
 * Le site envoie la réservation en JSON (en text/plain pour éviter le pré-vol CORS).
 * Les noms de champs suivent ceux de script.js (snake_case).
 */
function doPost(e) {
  programCache_ = null;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    // Champ piège invisible : seuls les robots le remplissent.
    if (cleanText_(body.website, 200)) throw new Error("Impossible de traiter cette demande.");
    if (body.type === "custom_request") {
      return jsonOutput_(createCustomRequest_(body));
    }
    const result = createBooking_({
      sessionId: body.session_id,
      name: body.name,
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email,
      phone: body.phone,
      message: body.message,
      participants: body.participants,
      idempotencyKey: body.idempotency_key,
      ageGroups: body.age_groups,
    });
    return jsonOutput_({
      ok: true,
      reference: result.reference,
      walk: result.walk,
      date: result.date,
      slot: result.slot,
      participants: result.participants,
      capacity: result.capacity,
      remaining: result.remaining,
      age_groups: result.ageGroups,
      price_estimate: result.priceEstimate,
      message: "Votre réservation est confirmée.",
    });
  } catch (error) {
    console.error(error);
    return jsonOutput_({
      error: "booking_failed",
      message: (error && error.message) || "La réservation n’a pas pu être enregistrée. Veuillez réessayer.",
    });
  }
}

function createCustomRequest_(body) {
  const firstName = cleanText_(body.first_name, 60);
  const lastName = cleanText_(body.last_name, 100);
  const email = cleanText_(body.email, 254);
  const phone = cleanText_(body.phone, 40);
  const topic = cleanText_(body.topic, 160) || "Visite sur demande";
  const date = cleanText_(body.date, 40);
  const slot = cleanText_(body.slot, 60);
  const rawParticipants = cleanText_(body.participants, 20);
  const message = cleanText_(body.message, 1200);
  // Balade visée quand la demande part d’un lien du site (champ dédié, pas le message).
  const requestedWalk = cleanText_(body.walk, 200);

  if (!firstName) throw new Error("Saisissez votre prénom.");
  if (!lastName) throw new Error("Saisissez votre nom.");
  if (!isValidEmail_(email)) throw new Error("Saisissez une adresse e-mail valide.");
  if (!phone) throw new Error("Saisissez votre numéro de téléphone.");
  if (!isValidPhone_(phone)) throw new Error("Le numéro de téléphone semble incomplet.");
  if (rawParticipants) {
    const count = Number(rawParticipants);
    const limit = SMALL_GROUP_TOPICS.indexOf(topic) !== -1 ? GROUP_CAPACITY : CUSTOM_CAPACITY;
    if (!Number.isInteger(count) || count < 1 || count > limit) {
      throw new Error(limit === GROUP_CAPACITY
        ? "Un groupe de seniors ou une visite en famille est limité à 20 personnes."
        : "Indiquez un nombre de personnes compris entre 1 et 100.");
    }
  }

  const fullName = `${firstName} ${lastName}`.trim();
  const guideTo = contactEmail_();
  const guidePhone = guidePhone_();
  const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(date) ? longFrenchDate_(date) : date;

  const ownerLines = [
    "Bonjour Marie-Tiyi,",
    "",
    "Une nouvelle demande sur mesure vient d’être envoyée depuis le site :",
    "",
    `• Contact : ${fullName}`,
    `• Téléphone : ${phone}`,
    `• E-mail : ${email}`,
    `• Type de sortie : ${topic}`,
    requestedWalk ? `• Balade souhaitée : ${requestedWalk}` : "",
    dateLabel ? `• Date souhaitée : ${dateLabel}` : "",
    slot && slot !== "À convenir" ? `• Créneau souhaité : ${slot}` : "",
    rawParticipants ? `• Nombre de personnes estimé : ${rawParticipants}` : "",
    "",
    message ? `Message :\n${message}` : "Aucun message complémentaire.",
  ].filter(Boolean).join("\n");

  MailApp.sendEmail(guideTo, `Demande sur mesure — ${topic} (${fullName})`, ownerLines, {
    name: `${quoteName_(fullName)} — Balades Culturelles`,
    replyTo: email,
  });

  try {
    const clientLines = [
      `Bonjour ${firstName},`,
      "",
      `J’ai bien reçu votre demande (${topic}) et je vous en remercie.`,
      "Je reviens vers vous très rapidement pour échanger sur votre sortie et construire la balade ensemble.",
      "",
      "Récapitulatif de votre demande :",
      `• Demande : ${topic}`,
      requestedWalk ? `• Balade souhaitée : ${requestedWalk}` : "",
      dateLabel ? `• Date souhaitée : ${dateLabel}` : "",
      slot && slot !== "À convenir" ? `• Créneau souhaité : ${slot}` : "",
      rawParticipants ? `• Nombre de personnes estimé : ${rawParticipants}` : "",
      message ? `• Précisions : ${message}` : "",
      "",
      "Si vous souhaitez ajouter une précision d’ici là, répondez simplement à cet e-mail.",
      "",
      "À très bientôt,",
      "Marie-Tiyi Jalon",
      `Téléphone : ${guidePhone}`,
      guideTo,
    ].filter(Boolean).join("\n");

    MailApp.sendEmail(`${quoteName_(fullName)} <${email}>`, `Votre demande a bien été reçue — Balades Culturelles`, clientLines, {
      name: CONTACT_NAME,
      replyTo: guideTo,
    });
  } catch (clientMailError) {
    console.error("Accusé de réception non envoyé pour la demande sur mesure : " + clientMailError);
  }

  return {
    ok: true,
    message: "Votre demande a bien été envoyée à Marie-Tiyi. Un e-mail récapitulatif vient de vous être adressé (pensez à vérifier vos indésirables).",
  };
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

/** Places restantes par date à venir, lues dans les compteurs (aucun tableur ouvert : réponse rapide). */
function getAvailability_() {
  const program = getProgram_();
  const stored = props_().getProperties();
  const sessions = program.sessions
    .filter((session) => !sessionHidden_(session))
    .map((session) => {
      const booked = parseStats_(stored[propertyKey_("stats:", session.id)]).booked;
      return {
        id: session.id,
        date: session.date,
        walk: session.walk,
        slot: session.slot,
        capacity: sessionCapacity_(session),
        booked: booked,
        remaining: Math.max(0, sessionCapacity_(session) - booked),
        ends_at_ms: sessionEndDate_(session).getTime(),
        ended: Date.now() >= sessionEndDate_(session).getTime(),
      };
    });
  return { capacity: program.capacity, sessions: sessions };
}

/* ------------------------------------------------------------------ */
/* Programme lu sur le site                                           */
/* ------------------------------------------------------------------ */

/** Adresse publique du site, toujours terminée par « / » (Propriétés du script → SITE_URL). */
function siteUrl_() {
  const configured = cleanText_(props_().getProperty("SITE_URL") || SITE_URL, 300);
  if (!configured) return SITE_URL;
  return /\/$/.test(configured) ? configured : `${configured}/`;
}

/** Lien vers une page du site publié (« faq.html », « balades.html »…). */
function sitePageUrl_(page) {
  return siteUrl_() + String(page || "").replace(/^\/+/, "");
}

function programmeUrl_() {
  return cleanText_(props_().getProperty("PROGRAMME_URL") || "", 300) || sitePageUrl_("programme.json");
}

/** Programme enregistré lors de la dernière lecture réussie du site. */
function getProgram_() {
  const base = baseProgram_();
  const sessions = sessionsWithAgenda_(base.sessions);
  return sessions === base.sessions ? base : Object.assign({}, base, { sessions: sessions });
}

/** Programme tel que publié sur le site, sans les dates ajoutées dans l’agenda. */
function baseProgram_() {
  if (programCache_) return programCache_;
  const stored = props_().getProperties();
  const parts = Number(stored.PROGRAM_PARTS) || 0;
  if (parts > 0) {
    let text = "";
    for (let index = 0; index < parts; index += 1) text += stored["PROGRAM_" + index] || "";
    try {
      programCache_ = expandProgram_(JSON.parse(text));
      return programCache_;
    } catch (error) {
      console.warn("Programme enregistré illisible : " + error);
    }
  }
  programCache_ = { loaded: false, capacity: DEFAULT_CAPACITY, prices: Object.assign({}, DEFAULT_PRICES), sessions: [], fetchedAt: "" };
  return programCache_;
}

/** Relit programme.json sur le site ; en cas d’échec, la dernière version reste utilisée. */
function refreshProgram_() {
  const url = programmeUrl_();
  try {
    const response = UrlFetchApp.fetch(`${url}${url.indexOf("?") === -1 ? "?" : "&"}t=${Date.now()}`, {
      muteHttpExceptions: true,
      followRedirects: true,
    });
    const code = response.getResponseCode();
    if (code !== 200) throw new Error(`réponse ${code}`);
    const program = parseProgramme_(JSON.parse(response.getContentText()));
    const previous = baseProgram_();
    const changed = !previous.loaded || programSignature_(previous) !== programSignature_(program);
    storeProgram_(program);
    return { ok: true, changed: changed, count: program.sessions.length };
  } catch (error) {
    const reason = String((error && error.message) || error);
    console.warn(`Programme du site non lu (${url}) : ${reason}`);
    return { ok: false, reason: reason };
  }
}

/** Vérifie le contenu de programme.json avant de l’utiliser. */
function parseProgramme_(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.sessions)) throw new Error("format inattendu");
  const capacity = Number(data.capacity);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) throw new Error("nombre de places invalide");
  const programCapacity = capacity;
  const prices = {};
  PRICE_KEYS.forEach((key) => {
    const value = data.prices ? Number(data.prices[key]) : NaN;
    if (!Number.isFinite(value) || value < 0 || value > 1000) throw new Error(`tarif « ${key} » invalide`);
    prices[key] = value;
  });
  const seen = {};
  const sessions = [];
  data.sessions.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const date = item.date;
    const walk = item.walk;
    const slot = item.slot;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (!isLabel_(walk, 200) || !isLabel_(slot, 80)) return;
    // Même identifiant que le site : « date|balade|horaire ».
    const id = `${date}|${walk}|${slot}`;
    if (seen[id]) return;
    seen[id] = true;
    // Les séances seniors et familles sont limitées à 20 places, le tout public à 25.
    const places = Number(item.capacity);
    const capacity = Number.isInteger(places) && places >= 1 && places <= 200 ? places : programCapacity;
    sessions.push({ id: id, date: date, walk: walk, slot: slot, capacity: capacity });
  });
  if (!sessions.length) throw new Error("aucune date valide");
  if (sessions.length > 400) throw new Error("trop de dates");
  sessions.sort((a, b) => compare_(a.date, b.date) || compare_(a.walk, b.walk) || compare_(a.slot, b.slot));
  return { loaded: true, capacity: capacity, prices: prices, sessions: sessions, fetchedAt: "" };
}

function programSignature_(program) {
  return JSON.stringify([
    program.capacity,
    PRICE_KEYS.map((key) => program.prices[key]),
    program.sessions.map((session) => [session.id, sessionCapacity_(session)]),
  ]);
}

/** Enregistre le programme en morceaux de texte ASCII (limite de 9 Ko par propriété). */
function storeProgram_(program) {
  const compact = {
    c: program.capacity,
    p: PRICE_KEYS.map((key) => program.prices[key]),
    s: program.sessions.map((session) => [session.date, session.walk, session.slot, sessionCapacity_(session)]),
    t: new Date().toISOString(),
  };
  const text = JSON.stringify(compact).replace(/[\u007f-\uffff]/g, (char) => "\\u" + ("0000" + char.charCodeAt(0).toString(16)).slice(-4));
  const parts = Math.max(1, Math.ceil(text.length / PROGRAM_CHUNK_CHARS));
  const values = { PROGRAM_PARTS: String(parts) };
  for (let index = 0; index < parts; index += 1) {
    values["PROGRAM_" + index] = text.substring(index * PROGRAM_CHUNK_CHARS, (index + 1) * PROGRAM_CHUNK_CHARS);
  }
  const store = props_();
  store.setProperties(values);
  Object.keys(store.getProperties()).forEach((key) => {
    const match = /^PROGRAM_(\d+)$/.exec(key);
    if (match && Number(match[1]) >= parts) store.deleteProperty(key);
  });
  programCache_ = expandProgram_(compact);
}

function expandProgram_(compact) {
  const prices = {};
  PRICE_KEYS.forEach((key, index) => {
    const value = Number(compact.p && compact.p[index]);
    prices[key] = Number.isFinite(value) ? value : DEFAULT_PRICES[key];
  });
  return {
    loaded: true,
    capacity: Number(compact.c) || DEFAULT_CAPACITY,
    prices: prices,
    sessions: (compact.s || []).map((item) => ({
      id: `${item[0]}|${item[1]}|${item[2]}`,
      date: item[0],
      walk: item[1],
      slot: item[2],
      capacity: Number(item[3]) > 0 ? Number(item[3]) : (Number(compact.c) || DEFAULT_CAPACITY),
    })),
    fetchedAt: compact.t || "",
  };
}

/** Places d’une séance : celles publiées, sinon la capacité globale du programme. */
function sessionCapacity_(session) {
  const places = Number(session && session.capacity);
  if (Number.isInteger(places) && places >= 1 && places <= 200) return places;
  return getProgram_().capacity;
}

/** Places d’une séance retrouvée par son identifiant « date|balade|horaire ». */
function sessionCapacityById_(id) {
  const sessions = getProgram_().sessions.filter((session) => session.id === id);
  return sessions.length ? sessionCapacity_(sessions[0]) : getProgram_().capacity;
}

function programAgeSeconds_() {
  const fetchedAt = Date.parse(getProgram_().fetchedAt || "");
  return Number.isNaN(fetchedAt) ? Infinity : (Date.now() - fetchedAt) / 1000;
}

/* ------------------------------------------------------------------ */
/* Réservation                                                        */
/* ------------------------------------------------------------------ */

function createBooking_(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Données de réservation invalides.");
  // Transition : l'ancien formulaire (encore en ligne) n'envoie qu'un nom complet.
  // Tant que first_name / last_name manquent, on garde les règles d'avant.
  const legacy = payload.firstName === undefined && payload.lastName === undefined;
  const firstName = cleanText_(payload.firstName, 60);
  const lastName = cleanText_(payload.lastName, 100);
  const name = legacy ? cleanText_(payload.name, 100) : lastName;
  const email = cleanText_(payload.email, 254);
  const phone = cleanText_(payload.phone, 40);
  const message = cleanText_(payload.message, 1000);
  const sessionId = cleanText_(payload.sessionId, 600);
  const idempotencyKey = cleanText_(payload.idempotencyKey, 100);

  if (!legacy) {
    if (!firstName) throw new Error("Saisissez votre prénom.");
    if (!lastName) throw new Error("Saisissez votre nom.");
    if (!phone) throw new Error("Saisissez votre numéro de téléphone.");
  }
  if (name.length < 1) throw new Error("Saisissez votre nom.");
  if (!isValidEmail_(email)) throw new Error("Saisissez une adresse e-mail valide.");
  if (phone && !isValidPhone_(phone)) throw new Error("Le numéro de téléphone semble incomplet.");

  let program = getProgram_();
  let session = program.sessions.find((item) => item.id === sessionId);
  if (!session && programAgeSeconds_() > 60) {
    // Date peut-être ajoutée sur le site depuis la dernière lecture du programme.
    refreshProgram_();
    program = getProgram_();
    session = program.sessions.find((item) => item.id === sessionId);
  }
  if (!session) throw new Error("Cette balade ou cette date n’est pas au programme.");
  if (Date.now() >= sessionEndDate_(session).getTime()) {
    throw new Error("Cette date est passée ou la balade est terminée. Choisissez une prochaine date.");
  }

  const capacity = sessionCapacity_(session);
  const participants = Number(payload.participants);
  if (!Number.isInteger(participants) || participants < 1 || participants > capacity) {
    throw new Error(`Le nombre de personnes doit être compris entre 1 et ${capacity}.`);
  }
  const ageGroups = validateAgeGroups_(payload.ageGroups, participants, capacity);
  const priceEstimate = PRICE_KEYS.reduce((total, key) => total + ageGroups[key] * program.prices[key], 0);

  return withLock_(30000, () => {
    const root = getRootFolder_();
    const dashboard = getDashboard_(root);
    const visit = getOrCreateVisit_(session, root, dashboard.getUrl(), capacity);
    const sheet = visitSheet_(visit);

    // La fiche fait foi : on recompte ses lignes, y compris vos ajouts ou annulations manuels.
    const visitEntries = readVisitEntries_(sheet);
    const stats = countStats_(visitEntries.map((entry) => entry.values));
    const remaining = capacity - stats.booked;

    // Le journal est inséré en tête : seules ses 200 lignes les plus récentes sont relues.
    // La recherche reste sous le verrou commun, avant toute écriture et avant la référence.
    const duplicate = findRecentJournalDuplicate_(dashboard, session, email, visitEntries, Date.now(), idempotencyKey);
    if (duplicate) {
      return {
        ok: true,
        reference: duplicate.reference,
        walk: session.walk,
        date: session.date,
        slot: session.slot,
        participants: duplicate.participants,
        capacity: capacity,
        remaining: Math.max(0, remaining),
        ageGroups: duplicate.ageGroups || ageGroups,
        priceEstimate: duplicate.priceEstimate,
      };
    }

    if (participants > remaining) {
      throw new Error(`Il ne reste que ${Math.max(0, remaining)} place(s) pour cette visite. Choisissez une autre date ou réduisez le nombre de personnes.`);
    }

    const reference = "BC-" + Utilities.getUuid().replace(/-/g, "").substring(0, 12).toUpperCase();
    const createdAt = new Date();
    const row = Math.max(sheet.getLastRow() + 1, VISIT_FIRST_ROW);
    // Les colonnes « Prénom » et « Paiement » sont vides ou « Non payé » : aucune
    // réservation n'est jamais déclarée payée automatiquement.
    sheet.getRange(row, 1, 1, VISIT_HEADERS.length).setValues([[
      reference,
      safeSheetText_(name),
      safeSheetText_(email),
      phoneCell_(phone),
      participants,
      ageGroups.standard,
      ageGroups.youth,
      ageGroups.child,
      ageGroups.underFive,
      priceEstimate,
      TO_CONTACT,
      createdAt,
      safeSheetText_(message),
      "",
      safeSheetText_(firstName),
      "Non payé",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]]);

    writeStats_(session.id, {
      booked: stats.booked + participants,
      bookings: stats.bookings + 1,
      toContact: stats.toContact + 1,
    });

    // La réservation est enregistrée : un souci sur le journal ou le tableau de bord
    // ne doit pas la faire échouer (la synchronisation suivante rattrapera).
    try {
      addJournalRow_(dashboard, session, visit.getUrl(), {
        createdAt, reference, name, firstName, email, phone, participants, priceEstimate, message, idempotencyKey,
      });
      writeDashboard_(dashboard);
    } catch (error) {
      console.error("Tableau de bord non mis à jour : " + error);
    }
    SpreadsheetApp.flush();

    // La réservation est enregistrée et écrite : la confirmation part ensuite.
    // Un échec d’envoi ne doit jamais annuler une réservation déjà enregistrée.
    sendConfirmationEmail_({
      reference: reference,
      name: name,
      firstName: firstName,
      email: email,
      session: session,
      participants: participants,
      priceEstimate: priceEstimate,
      sheet: sheet,
      dashboard: dashboard,
    });
    // Agenda de la guide : la date et le nombre de places suivent la réservation.
    syncCalendarSafely_(session.id);

    return {
      ok: true,
      reference: reference,
      walk: session.walk,
      date: session.date,
      slot: session.slot,
      participants: participants,
      capacity: capacity,
      remaining: remaining - participants,
      ageGroups: ageGroups,
      priceEstimate: priceEstimate,
    };
  });
}

/** Date du journal comparée à l’identifiant de séance (Sheets renvoie généralement un Date). */
function journalDateMatches_(value, isoDate) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, TIME_ZONE, "yyyy-MM-dd") === isoDate;
  }
  return String(value == null ? "" : value).trim() === isoDate;
}

/**
 * Cherche un doublon récent dans les 200 entrées les plus récentes du journal.
 * Une ligne annulée dans la fiche de date n’est pas considérée comme active.
 */
function idempotencyHash_(value) {
  const key = cleanText_(value, 100);
  if (!key) return "";
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key, Utilities.Charset.UTF_8);
  return digest.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0")).join("");
}

function findRecentJournalDuplicate_(dashboard, session, email, visitEntries, nowMs, idempotencyKey) {
  const journal = dashboard.getSheetByName(JOURNAL_SHEET);
  if (!journal) return null;
  const count = Math.min(200, journal.getLastRow() - 1);
  if (count < 1) return null;

  const emailKey = cleanText_(email, 254).toLowerCase();
  const idempotencyHash = idempotencyHash_(idempotencyKey);
  const rows = journal.getRange(2, 1, count, JOURNAL_HEADERS.length).getValues();
  for (const row of rows) {
    const storedHash = String(row[JOURNAL_IDEMPOTENCY_COLUMN - 1] || "").trim();
    const sameKey = Boolean(idempotencyHash && storedHash === idempotencyHash);
    if (!journalDateMatches_(row[1], session.date)) continue;
    if (String(row[2] || "") !== session.walk || String(row[3] || "") !== session.slot) continue;

    if (!sameKey) {
      if (cleanText_(row[6], 254).toLowerCase() !== emailKey) continue;
      const createdAt = row[0] instanceof Date ? row[0].getTime() : Date.parse(String(row[0] || ""));
      const ageMs = nowMs - createdAt;
      if (!Number.isFinite(createdAt) || ageMs < 0 || ageMs >= 120000) continue;
    }

    const reference = String(row[4] || "").trim();
    if (!reference) continue;
    const visitEntry = visitEntries.find((entry) => String(entry.values[0] || "").trim() === reference);
    if (visitEntry && String(visitEntry.values[VISIT_COL.status - 1] || "").trim() === CANCELLED) continue;

    const values = visitEntry && visitEntry.values;
    return {
      reference: reference,
      participants: Number(row[8]) || 0,
      priceEstimate: Number(row[9]) || 0,
      ageGroups: values ? {
        standard: Number(values[5]) || 0,
        youth: Number(values[6]) || 0,
        child: Number(values[7]) || 0,
        underFive: Number(values[8]) || 0,
      } : null,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Dossiers et fichiers dans le Drive                                 */
/* ------------------------------------------------------------------ */

function getRootFolder_() {
  const id = props_().getProperty("ROOT_FOLDER_ID");
  if (id) {
    try {
      const folder = DriveApp.getFolderById(id);
      if (!folder.isTrashed()) return folder;
    } catch (error) {
      // Dossier supprimé : on le recrée ci-dessous.
    }
  }
  // Dossier retrouvé par son nom à la racine du Drive (hors corbeille), sinon créé.
  const folder = getChildFolder_(DriveApp.getRootFolder(), ROOT_FOLDER_NAME);
  props_().setProperty("ROOT_FOLDER_ID", folder.getId());
  return folder;
}

function getChildFolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  while (existing.hasNext()) {
    const folder = existing.next();
    if (!folder.isTrashed()) return folder;
  }
  return parent.createFolder(name);
}

function findSpreadsheet_(folder, name) {
  const files = folder.getFilesByName(name);
  while (files.hasNext()) {
    const file = files.next();
    if (!file.isTrashed() && file.getMimeType() === MimeType.GOOGLE_SHEETS) return SpreadsheetApp.openById(file.getId());
  }
  return null;
}

function createSpreadsheetIn_(folder, name) {
  const spreadsheet = SpreadsheetApp.create(name);
  DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
  spreadsheet.setSpreadsheetTimeZone(TIME_ZONE);
  spreadsheet.setSpreadsheetLocale("fr_FR");
  return spreadsheet;
}

/** Ouvre un tableur s’il existe encore et n’est pas à la corbeille. */
function openIfAlive_(id) {
  if (!id) return null;
  try {
    if (DriveApp.getFileById(id).isTrashed()) return null;
    return SpreadsheetApp.openById(id);
  } catch (error) {
    return null;
  }
}

function getDashboard_(root) {
  const known = openIfAlive_(props_().getProperty("DASHBOARD_ID"));
  if (known) return known;
  let dashboard = findSpreadsheet_(root, DASHBOARD_NAME);
  if (!dashboard) {
    dashboard = createSpreadsheetIn_(root, DASHBOARD_NAME);
    setupDashboard_(dashboard);
  }
  props_().setProperty("DASHBOARD_ID", dashboard.getId());
  return dashboard;
}

function getOrCreateVisit_(session, root, dashboardUrl, capacity) {
  const record = parseVisit_(props_().getProperty(propertyKey_("visit:", session.id)));
  const known = record && openIfAlive_(record.fileId);
  if (known) return known;
  const monthFolder = getChildFolder_(root, monthFolderName_(session.date));
  const name = visitFileName_(session);
  let visit = findSpreadsheet_(monthFolder, name);
  if (!visit) {
    visit = createSpreadsheetIn_(monthFolder, name);
    setupVisit_(visit, session, dashboardUrl, capacity);
  }
  writeVisit_(session, visit.getId());
  return visit;
}

function visitSheet_(visit) {
  return visit.getSheetByName(VISIT_SHEET) || visit.getSheets()[0];
}

/** Fiche connue pour une date : identifiant du fichier + date, balade, horaire. */
function writeVisit_(session, fileId) {
  props_().setProperty(propertyKey_("visit:", session.id), JSON.stringify({ f: fileId, d: session.date, w: session.walk, s: session.slot }));
}

function parseVisit_(value) {
  if (!value) return null;
  try {
    const record = JSON.parse(value);
    if (!record || !record.f) return null;
    return {
      fileId: String(record.f),
      date: String(record.d || ""),
      walk: String(record.w || ""),
      slot: String(record.s || ""),
      id: record.d && record.w && record.s ? `${record.d}|${record.w}|${record.s}` : "",
    };
  } catch (error) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Mise en forme                                                      */
/* ------------------------------------------------------------------ */

function setupVisit_(visit, session, dashboardUrl, capacity) {
  const sheet = visit.getSheets()[0].setName(VISIT_SHEET);
  const width = VISIT_HEADERS.length;
  const first = VISIT_FIRST_ROW;
  sheet.setHiddenGridlines(true);

  sheet.getRange("A1").setValue(session.walk).setFontSize(18).setFontWeight("bold").setFontColor(COLORS.forest);
  sheet.getRange("A2").setValue(`${longFrenchDate_(session.date)} · ${session.slot}`).setFontSize(11).setFontColor(COLORS.muted);
  sheet.getRange("A4").setValue("Lieu de rendez-vous :").setFontWeight("bold");
  sheet.getRange("B4:E4").merge().setBackground("#fff6dc")
    .setNote("Notez ici le point de rendez-vous de cette balade.");

  sheet.getRange(VISIT_HEADER_ROW, 1, 1, width).setValues([VISIT_HEADERS.slice()])
    .setFontWeight("bold").setFontColor(COLORS.white).setBackground(COLORS.forest)
    .setWrap(true).setVerticalAlignment("middle");
  sheet.setRowHeight(VISIT_HEADER_ROW, 40);
  sheet.setFrozenRows(VISIT_HEADER_ROW);

  writeVisitGroupLabels_(sheet);
  applyVisitFormats_(sheet);
  applyVisitValidations_(sheet);
  writeVisitFormulas_(sheet, dashboardUrl, capacity);
  writeVisitWidths_(sheet);

  const maxRows = sheet.getMaxRows();
  const dataRows = Math.max(1, maxRows - first + 1);
  const table = sheet.getRange(first, 1, dataRows, width);
  const statusIs = (status) => `=$K${first}="${status}"`;
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(statusIs(CANCELLED))
      .setFontColor("#9a9a92").setStrikethrough(true).setRanges([table]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(statusIs(TO_CONTACT))
      .setBackground("#fbeee8").setRanges([table]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(statusIs("Contactée"))
      .setBackground("#e6f0f3").setRanges([table]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(statusIs("Réalisée"))
      .setBackground("#eaf1e3").setRanges([table]).build(),
  ]);
}

/**
 * Complète une fiche déjà en service : nouvelles colonnes (prénom, paiements),
 * formules réparées et totaux. Les données des participants ne sont jamais
 * déplacées, réécrites ni supprimées.
 */
function ensureVisitLayout_(sheet, file, dashboardUrl, capacity, entries) {
  const width = VISIT_HEADERS.length;
  const headers = sheet.getRange(VISIT_HEADER_ROW, 1, 1, width).getValues()[0]
    .map((value) => String(value == null ? "" : value));
  const expected = VISIT_HEADERS.slice();
  const complete = expected.every((title, index) => headers[index] === title);
  if (!complete) {
    // Les quatorze premières colonnes ne changent jamais : rien n’est décalé.
    const from = VISIT_COL.firstName;
    sheet.getRange(VISIT_HEADER_ROW, from, 1, expected.length - from + 1).setValues([expected.slice(from - 1)])
      .setFontWeight("bold").setFontColor(COLORS.white).setBackground(COLORS.forest)
      .setWrap(true).setVerticalAlignment("middle");
    writeVisitGroupLabels_(sheet);
    applyVisitFormats_(sheet);
    applyVisitValidations_(sheet);
    writeVisitWidths_(sheet);
  }
  // Formules au format français (points-virgules) : les anciennes fiches
  // affichaient « #ERROR! » parce qu’elles avaient été écrites avec des virgules.
  const places = placesFormula_(capacity);
  if (String(sheet.getRange("A3").getValue() || "") !== places) {
    sheet.getRange("A3").setFormula(places).setFontWeight("bold").setFontColor(COLORS.clay);
  }
  const link = `=HYPERLINK("${dashboardUrl}";"← Tableau de bord")`;
  if (String(sheet.getRange("G4").getValue() || "") !== link) {
    sheet.getRange("G4").setFormula(link).setFontWeight("bold");
  }
  // Total encaissé de chaque ligne (formule sans séparateur : valable partout).
  (entries || []).forEach((entry) => {
    const formula = `=Q${entry.row}+T${entry.row}`;
    if (String(entry.values[VISIT_COL.total - 1] == null ? "" : entry.values[VISIT_COL.total - 1]) !== formula) {
      sheet.getRange(entry.row, VISIT_COL.total).setFormula(formula);
    }
  });
}

/** Ligne « Places : … réservées » : toujours à jour, même après une modification à la main. */
function placesFormula_(capacity) {
  const first = VISIT_FIRST_ROW;
  const booked = `SUMIFS(E${first}:E;K${first}:K;"<>${CANCELLED}")`;
  return `="Places : " & ${booked} & " réservées · " & (${capacity} - ${booked}) & " restantes sur ${capacity}"`;
}

function writeVisitFormulas_(sheet, dashboardUrl, capacity) {
  sheet.getRange("A3").setFormula(placesFormula_(capacity))
    .setFontWeight("bold").setFontColor(COLORS.clay);
  sheet.getRange("G4").setFormula(`=HYPERLINK("${dashboardUrl}";"← Tableau de bord")`).setFontWeight("bold");
}

/** Titres de groupes au-dessus des nouvelles colonnes (ligne 5, jusque-là vide). */
function writeVisitGroupLabels_(sheet) {
  const groups = [
    { from: VISIT_COL.firstName, to: VISIT_COL.firstName, text: "Identité" },
    { from: VISIT_COL.payment, to: VISIT_COL.total, text: "Paiements" },
    { from: VISIT_COL.refund, to: VISIT_COL.refundMethod, text: "Remboursement" },
  ];
  groups.forEach((group) => {
    if (group.to > group.from) sheet.getRange(VISIT_HEADER_ROW - 1, group.from, 1, group.to - group.from + 1).merge();
    sheet.getRange(VISIT_HEADER_ROW - 1, group.from).setValue(group.text)
      .setFontWeight("bold").setFontColor(COLORS.muted);
  });
}

function applyVisitFormats_(sheet) {
  const first = VISIT_FIRST_ROW;
  const dataRows = Math.max(1, sheet.getMaxRows() - first + 1);
  sheet.getRange(first, VISIT_COL.people, dataRows, 6).setNumberFormat("0");
  sheet.getRange(first, VISIT_COL.createdAt, dataRows, 1).setNumberFormat("dd/mm/yyyy hh:mm");
  [VISIT_COL.amount, VISIT_COL.amount2, VISIT_COL.total, VISIT_COL.refund].forEach((column) => {
    sheet.getRange(first, column, dataRows, 1).setNumberFormat("0.00");
  });
  [VISIT_COL.payDate, VISIT_COL.payDate2, VISIT_COL.refundDate].forEach((column) => {
    sheet.getRange(first, column, dataRows, 1).setNumberFormat("dd/mm/yyyy");
  });
}

function applyVisitValidations_(sheet) {
  const first = VISIT_FIRST_ROW;
  const dataRows = Math.max(1, sheet.getMaxRows() - first + 1);
  sheet.getRange(first, VISIT_COL.status, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(STATUSES.slice(), true)
      .setAllowInvalid(false)
      .setHelpText("Confirmée = à contacter · Contactée = point de rendez-vous envoyé · Réalisée · Annulée = places libérées.")
      .build(),
  );
  sheet.getRange(first, VISIT_COL.payment, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(PAYMENT_STATUSES.slice(), true)
      .setAllowInvalid(false)
      .setHelpText("Non payé = rien reçu · Payé = montant et date remplis tout seuls · Partiel = montant réellement reçu · Remboursé = voir la colonne Remboursement.")
      .build(),
  );
  [VISIT_COL.payMethod, VISIT_COL.payMethod2, VISIT_COL.refundMethod].forEach((column) => {
    sheet.getRange(first, column, dataRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(PAYMENT_METHODS.slice(), true)
        .setAllowInvalid(false)
        .setHelpText("Espèces · Carte · Virement · Chèque.")
        .build(),
    );
  });
}

const VISIT_WIDTHS = Object.freeze([
  120, 170, 220, 130, 85, 95, 95, 95, 95, 95, 110, 130, 260, 220,
  130, 120, 140, 120, 130, 130, 125, 135, 140, 140, 135, 135,
]);

function writeVisitWidths_(sheet) {
  VISIT_WIDTHS.forEach((size, index) => sheet.setColumnWidth(index + 1, size));
}

/**
 * « Payé » : reprend le montant estimé et la date de la balade, mais seulement
 * si ces champs sont vides. Un montant ou une date déjà saisis ne sont jamais
 * écrasés, et un 0 saisi volontairement compte comme une valeur.
 */
function applyPaidShortcut_(sheet, entries, file) {
  entries.forEach((entry) => {
    const values = entry.values;
    if (String(values[VISIT_COL.payment - 1] == null ? "" : values[VISIT_COL.payment - 1]).trim() !== "Payé") return;
    const estimated = Number(values[VISIT_COL.estimated - 1]) || 0;
    const amountEmpty = isEmptyCell_(values[VISIT_COL.amount - 1]);
    const dateEmpty = isEmptyCell_(values[VISIT_COL.payDate - 1]);
    if (!amountEmpty && !dateEmpty) return;
    if (amountEmpty && estimated > 0) {
      sheet.getRange(entry.row, VISIT_COL.amount).setValue(estimated);
      values[VISIT_COL.amount - 1] = estimated;
    }
    if (dateEmpty && file.date) {
      sheet.getRange(entry.row, VISIT_COL.payDate).setValue(sheetDate_(file.date));
      values[VISIT_COL.payDate - 1] = sheetDate_(file.date);
    }
  });
}

function setupDashboard_(dashboard) {
  const sheets = dashboard.getSheets();
  const board = dashboard.getSheetByName(DASHBOARD_SHEET) || sheets[0].setName(DASHBOARD_SHEET);
  const journal = dashboard.getSheetByName(JOURNAL_SHEET) || dashboard.insertSheet(JOURNAL_SHEET);
  const width = DASHBOARD_HEADERS.length;
  const first = DASHBOARD_FIRST_ROW;

  board.setHiddenGridlines(true);
  board.getRange(DASHBOARD_HEADER_ROW, 1, 1, width).setValues([DASHBOARD_HEADERS.slice()])
    .setFontWeight("bold").setFontColor(COLORS.white).setBackground(COLORS.forest).setVerticalAlignment("middle");
  board.setRowHeight(DASHBOARD_HEADER_ROW, 32);
  board.setFrozenRows(DASHBOARD_HEADER_ROW);
  const rows = Math.max(1, board.getMaxRows() - first + 1);
  board.getRange(first, 1, rows, 1).setNumberFormat("ddd dd/mm/yyyy");
  const table = board.getRange(first, 1, rows, width);
  const stateColumn = board.getRange(first, 7, rows, 1);
  board.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$G${first}="Passée"`)
      .setFontColor("#9a9a92").setRanges([table]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(REMOVED_STATE)
      .setBackground("#8c3426").setFontColor(COLORS.white).setBold(true).setRanges([stateColumn]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Complet")
      .setBackground("#f4d9d0").setFontColor("#8c3426").setBold(true).setRanges([stateColumn]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Presque complet")
      .setBackground("#fbeccf").setFontColor("#8a5a12").setRanges([stateColumn]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0)
      .setBackground("#fbeee8").setFontColor(COLORS.clay).setBold(true).setRanges([board.getRange(first, 8, rows, 1)]).build(),
  ]);
  [130, 300, 120, 115, 100, 130, 140, 110, 170].forEach((size, index) => board.setColumnWidth(index + 1, size));

  journal.getRange(1, 1, 1, JOURNAL_HEADERS.length).setValues([JOURNAL_HEADERS.slice()])
    .setFontWeight("bold").setFontColor(COLORS.white).setBackground(COLORS.forest);
  journal.setFrozenRows(1);
  const journalRows = Math.max(1, journal.getMaxRows() - 1);
  journal.getRange(2, 1, journalRows, 1).setNumberFormat("dd/mm/yyyy hh:mm");
  journal.getRange(2, 2, journalRows, 1).setNumberFormat("ddd dd/mm/yyyy");
  [130, 130, 280, 110, 130, 170, 220, 130, 90, 120, 150].forEach((size, index) => journal.setColumnWidth(index + 1, size));
  journal.setColumnWidth(JOURNAL_EMAIL_FAILURE_COLUMN, 180);
}

/**
 * Réécrit le tableau de bord : toutes les dates du programme, plus les dates retirées
 * du site qui ont encore une fiche (pour penser à prévenir les participants).
 */
function writeDashboard_(dashboard) {
  const sheet = dashboard.getSheetByName(DASHBOARD_SHEET) || dashboard.getSheets()[0];
  const program = getProgram_();
  const stored = props_().getProperties();
  const today = todayParis_();
  const keepFrom = isoDaysAgo_(REMOVED_KEEP_DAYS);
  const inProgram = {};
  program.sessions.forEach((session) => { inProgram[session.id] = true; });

  const removed = [];
  Object.keys(stored).forEach((key) => {
    if (key.indexOf("visit:") !== 0) return;
    const record = parseVisit_(stored[key]);
    if (!record || !record.id || inProgram[record.id] || record.date < keepFrom) return;
    removed.push({ id: record.id, date: record.date, walk: record.walk, slot: record.slot, removed: true });
  });
  const entries = program.sessions.map((session) => Object.assign({ removed: false }, session)).concat(removed)
    .sort((a, b) => compare_(a.date, b.date) || compare_(a.walk, b.walk) || compare_(a.slot, b.slot));

  const totals = { bookings: 0, people: 0, remaining: 0, toContact: 0, dates: 0, removedWithBookings: 0 };
  const rows = entries.map((session) => {
    const stats = parseStats_(stored[propertyKey_("stats:", session.id)]);
    const record = parseVisit_(stored[propertyKey_("visit:", session.id)]);
    const remaining = Math.max(0, sessionCapacity_(session) - stats.booked);
    const past = session.date < today;
    let state = "Places disponibles";
    if (session.removed) state = REMOVED_STATE;
    else if (past) state = "Passée";
    else if (remaining === 0) state = "Complet";
    else if (remaining <= 5) state = "Presque complet";
    if (session.removed && stats.bookings > 0) totals.removedWithBookings += 1;
    if (!past && !session.removed) {
      totals.dates += 1;
      totals.bookings += stats.bookings;
      totals.people += stats.booked;
      totals.remaining += remaining;
      totals.toContact += stats.toContact;
    }
    return [
      sheetDate_(session.date),
      session.walk,
      session.slot,
      stats.bookings,
      stats.booked,
      session.removed ? "—" : remaining,
      state,
      stats.toContact,
      record ? `=HYPERLINK("https://docs.google.com/spreadsheets/d/${record.fileId}/edit";"Ouvrir la fiche")` : "Pas encore de réservation",
    ];
  });

  sheet.getRange("A1").setValue("Balades Culturelles — Réservations").setFontSize(18).setFontWeight("bold").setFontColor(COLORS.forest);
  const warning = totals.removedWithBookings
    ? ` · ⚠ ${totals.removedWithBookings} date(s) retirée(s) du site avec des réservations : prévenez les participants`
    : "";
  sheet.getRange("A2")
    .setValue(`À venir : ${totals.bookings} réservation(s) · ${totals.people} personne(s) · ${totals.remaining} place(s) restante(s) sur ${totals.dates} date(s) · ${totals.toContact} à contacter${warning}`)
    .setFontWeight("bold").setFontColor(totals.toContact || totals.removedWithBookings ? COLORS.clay : COLORS.forest);
  const programNote = program.loaded && program.fetchedAt
    ? `programme lu sur le site le ${Utilities.formatDate(new Date(program.fetchedAt), TIME_ZONE, "dd/MM/yyyy 'à' HH:mm")} (${program.sessions.length} dates)`
    : "programme du site pas encore lu";
  sheet.getRange("A3")
    .setValue(`Mis à jour le ${Utilities.formatDate(new Date(), TIME_ZONE, "dd/MM/yyyy 'à' HH:mm")} · ${programNote} · actualisation à chaque réservation et toutes les ${SYNC_EVERY_MINUTES} minutes · moteur ${ENGINE_VERSION}`)
    .setFontColor(COLORS.muted);
  // Lien inverse : depuis le Drive, on revient au site public en un clic.
  sheet.getRange("A4")
    .setFormula(`=HYPERLINK("${siteUrl_()}";"Ouvrir le site public")`)
    .setFontColor(COLORS.forest).setFontWeight("bold");

  const first = DASHBOARD_FIRST_ROW;
  const previous = sheet.getLastRow() - first + 1;
  if (previous > rows.length) {
    sheet.getRange(first + rows.length, 1, previous - rows.length, DASHBOARD_HEADERS.length).clearContent();
  }
  if (rows.length) sheet.getRange(first, 1, rows.length, DASHBOARD_HEADERS.length).setValues(rows);
}

function addJournalRow_(dashboard, session, visitUrl, booking) {
  const sheet = dashboard.getSheetByName(JOURNAL_SHEET) || dashboard.insertSheet(JOURNAL_SHEET);
  sheet.getRange(1, 1, 1, JOURNAL_HEADERS.length).setValues([JOURNAL_HEADERS.slice()]);
  // La réservation la plus récente en haut.
  sheet.insertRowsAfter(1, 1);
  sheet.getRange(2, 1, 1, JOURNAL_HEADERS.length).setValues([[
    booking.createdAt,
    sheetDate_(session.date),
    session.walk,
    session.slot,
    booking.reference,
    safeSheetText_(booking.name),
    safeSheetText_(booking.email),
    phoneCell_(booking.phone),
    booking.participants,
    booking.priceEstimate,
    `=HYPERLINK("${visitUrl}";"Ouvrir la fiche")`,
    safeSheetText_(booking.message || ""),
    safeSheetText_(booking.firstName || ""),
    "",
    idempotencyHash_(booking.idempotencyKey),
  ]]).setFontWeight("normal").setFontColor("#242a23").setBackground(null);
  sheet.getRange(2, 1).setNumberFormat("dd/mm/yyyy hh:mm");
  sheet.getRange(2, 2).setNumberFormat("ddd dd/mm/yyyy");
}

/** Signale dans le journal, sans échec en cascade, une confirmation non envoyée. */
function markJournalEmailFailure_(dashboard, reference) {
  if (!dashboard || !reference) return;
  const journal = dashboard.getSheetByName(JOURNAL_SHEET);
  if (!journal) return;
  const count = Math.min(200, journal.getLastRow() - 1);
  if (count < 1) return;
  const references = journal.getRange(2, 5, count, 1).getValues();
  const index = references.findIndex((row) => String(row[0] || "").trim() === reference);
  if (index < 0) return;
  journal.getRange(index + 2, JOURNAL_EMAIL_FAILURE_COLUMN).setValue("Échec d’envoi");
}

/* ------------------------------------------------------------------ */
/* E-mail de confirmation                                             */
/* ------------------------------------------------------------------ */

/**
 * Envoie la confirmation au client uniquement.
 * Jamais d’erreur renvoyée : la réservation est déjà enregistrée à ce stade.
 */
function sendConfirmationEmail_(booking) {
  try {
    const to = contactEmail_();
    const content = buildConfirmationEmail_(booking);
    MailApp.sendEmail(`${quoteName_(displayName_(booking.firstName, booking.name))} <${booking.email}>`, content.subject, content.text, {
      name: CONTACT_NAME,
      replyTo: to,
      htmlBody: content.html,
    });
  } catch (error) {
    console.error("E-mail de confirmation non envoyé pour " + booking.reference + " : " + error);
    try {
      markJournalEmailFailure_(booking.dashboard, booking.reference);
    } catch (journalError) {
      console.error("Échec du signalement dans le journal pour " + booking.reference + " : " + journalError);
    }
  }
}

/* Les deux tâches sont appelées sous le verrou commun aux réservations.
 * MailApp et PropertiesService ne forment pas une transaction : un arrêt brutal
 * entre l'envoi réussi et son enregistrement reste une limite de Google. */
function sendOwnerEmail_(subject, text) {
  MailApp.sendEmail(contactEmail_(), subject, text, {
    name: CONTACT_NAME, replyTo: contactEmail_(),
  });
}

/** Convertit une heure civile de Paris en instant, y compris en heure d’été. */
function parisInstant_(iso, hour, minute) {
  const target = Date.parse(`${iso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  let instant = target;
  for (let i = 0; i < 3; i += 1) {
    const local = Utilities.formatDate(new Date(instant), TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss");
    instant += target - Date.parse(local + "Z");
  }
  return instant;
}

function nextDay_(iso) {
  return new Date(Date.parse(iso + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
}

/** Une seule petite propriété : référence du dernier journal envoyé et prochaine échéance.
 * Le journal conserve les réservations même si une fiche est retirée du programme.
 * Ne pas supprimer ses lignes : elles constituent l'historique des envois. */
function sendDailySummary_(dashboard) {
  try {
    const store = props_();
    const key = "mail:daily";
    let checkpoint = JSON.parse(store.getProperty(key) || "null");
    if (!checkpoint) {
      checkpoint = { nextDue: parisInstant_(todayParis_(), 17, 0), lastRef: "" };
      store.setProperty(key, JSON.stringify(checkpoint));
    }
    if (Date.now() < checkpoint.nextDue) return;
    const journal = dashboard.getSheetByName(JOURNAL_SHEET);
    const count = journal.getLastRow() - 1;
    const rows = count > 0 ? journal.getRange(2, 1, count, JOURNAL_HEADERS.length).getValues().filter((row) => row[4]) : [];
    const boundary = checkpoint.lastRef ? rows.findIndex((row) => row[4] === checkpoint.lastRef) : rows.length;
    if (boundary < 0) throw new Error("La dernière référence envoyée manque dans le journal ; restaurer le journal avant de reprendre.");
    const fresh = rows.slice(0, boundary);
    if (!fresh.length) {
      // Seule l’échéance change : la dernière réservation envoyée reste intacte.
      checkpoint.nextDue = parisInstant_(nextDay_(todayParis_()), 17, 0);
      store.setProperty(key, JSON.stringify(checkpoint));
      return;
    }
    const text = ["Nouvelles réservations depuis le dernier récapitulatif réussi", ""];
    fresh.slice().reverse().forEach((row) => {
      const date = Utilities.formatDate(new Date(row[1]), TIME_ZONE, "yyyy-MM-dd");
      let message = row[11];
      let firstName = String(row[12] == null ? "" : row[12]).trim();
      // Anciennes réservations : le message et le prénom n’étaient pas encore copiés au journal.
      if (!message || !firstName) {
        const record = parseVisit_(store.getProperty(propertyKey_("visit:", `${date}|${row[2]}|${row[3]}`)));
        const visit = record && openIfAlive_(record.fileId);
        const participant = visit && readVisitRows_(visitSheet_(visit)).find((item) => item[0] === row[4]);
        if (participant) {
          if (!message) message = participant[12];
          if (!firstName) firstName = String(participant[VISIT_COL.firstName - 1] == null ? "" : participant[VISIT_COL.firstName - 1]).trim();
        }
      }
      text.push(`${row[2]} — ${longFrenchDate_(date).toLowerCase()} — ${row[3]}`,
        `Nom : ${displayName_(firstName, row[5])}`, `E-mail : ${row[6]}`, `Téléphone : ${String(row[7]).replace(/^'/, "")}`,
        `Personnes : ${row[8]}`, `Montant estimé : ${frenchAmount_(row[9])} €`,
        `Message du client : ${message || "—"}`, `Référence : ${row[4]}`, "");
    });
    sendOwnerEmail_(`Nouvelles réservations — ${todayParis_()} (${fresh.length})`, text.join("\n"));
    store.setProperty(key, JSON.stringify({ lastRef: fresh[0][4],
      nextDue: parisInstant_(nextDay_(todayParis_()), 17, 0), sentAt: new Date().toISOString() }));
  } catch (error) {
    console.error("Récapitulatif quotidien non envoyé ou succès non enregistré : " + error);
  }
}

/** Un compte rendu par créneau, retenté tant qu'il reste à venir. */
function sendVisitReports_() {
  getProgram_().sessions.forEach((session) => {
    try {
      const match = /^(\d{1,2})\s*(?:h|:)\s*(\d{2})?/.exec(session.slot);
      if (!match) throw new Error("Horaire non reconnu : " + session.slot);
      const start = parisInstant_(session.date, Number(match[1]), Number(match[2] || 0));
      const now = Date.now();
      if (now >= start || now < start - 48 * 3600000) return;
      const key = propertyKey_("mail:visit:", session.id);
      if (props_().getProperty(key)) return;
      const record = parseVisit_(props_().getProperty(propertyKey_("visit:", session.id)));
      const visit = record && openIfAlive_(record.fileId);
      if (record && !visit) throw new Error("Fiche inaccessible : " + session.id);
      const sheet = visit ? visitSheet_(visit) : null;
      const rows = sheet ? readVisitRows_(sheet).filter((row) => String(row[10]).trim() !== CANCELLED && Number(row[4]) > 0) : [];
      const stats = countStats_(rows);
      const text = [session.walk, `${longFrenchDate_(session.date).toLowerCase()} — ${session.slot}`,
        sheet ? meetingLine_(sheet) : MEETING_FALLBACK,
        `Personnes : ${stats.booked}`, `Places restantes : ${Math.max(0, sessionCapacity_(session) - stats.booked)}`, "", "Participants non annulés", ""];
      rows.forEach((row) => {
        const firstName = String(row[VISIT_COL.firstName - 1] == null ? "" : row[VISIT_COL.firstName - 1]).trim();
        text.push(`Nom : ${displayName_(firstName, row[1])}`, `E-mail : ${row[2]}`, `Téléphone : ${String(row[3]).replace(/^'/, "")}`,
          `Personnes : ${row[4]}`, `Montant : ${frenchAmount_(row[9])} €`, `Étape : ${row[10]}`,
          `Message du client : ${row[12] || "—"}`, `Référence : ${row[0]}`);
        if (row[13]) text.push(`Vos notes : ${row[13]}`);
        text.push("");
      });
      if (!rows.length) text.push("Aucun participant inscrit.");
      sendOwnerEmail_(`Compte rendu — ${session.walk}, ${longFrenchDate_(session.date).toLowerCase()}`, text.join("\n"));
      props_().setProperty(key, session.date);
    } catch (error) {
      console.error("Compte rendu non envoyé ou succès non enregistré pour " + session.id + " : " + error);
    }
  });
}

/** Adresse d’envoi et de réponse, modifiable dans les propriétés du script. */
function contactEmail_() {
  return props_().getProperty("CONTACT_EMAIL") || CONTACT_EMAIL;
}

/** Numéro professionnel de la guide (signature des confirmations), modifiable
 * dans les propriétés du script. Distinct des téléphones des clients. */
function guidePhone_() {
  return cleanText_(props_().getProperty("GUIDE_PHONE") || GUIDE_PHONE, 40);
}

/** Numéro cliquable pour un téléphone : « 06 01 74 04 49 » → « +33601740449 ». */
function telHref_(phone) {
  const raw = String(phone || "").replace(/[^\d+]/g, "");
  if (!raw) return "";
  if (raw.charAt(0) === "+") return "+" + raw.slice(1).replace(/\D/g, "");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.indexOf("00") === 0) return "+" + digits.slice(2);
  if (digits.charAt(0) === "0") return "+33" + digits.slice(1);
  return "+" + digits;
}

/** Objet, texte et HTML de la confirmation. */
function buildConfirmationEmail_(booking) {
  const session = booking.session;
  // Dans la fiche le jour prend une majuscule ; dans une phrase, il reste en minuscule
  // (« samedi 27 février 2027 »).
  const longDate = longFrenchDate_(session.date).toLowerCase();
  const recap = [
    `- Balade : ${session.walk}`,
    `- Date : ${longDate}`,
    `- Horaire : ${session.slot}`,
    `- Personnes : ${booking.participants} personne${booking.participants > 1 ? "s" : ""}`,
    `- Estimation : ${frenchAmount_(booking.priceEstimate)} €`,
    `- Votre référence : ${booking.reference}`,
  ];
  const closing = QUARTIER_WORDS.some((word) => session.walk.toLowerCase().indexOf(word) !== -1)
    ? "Au plaisir de vous faire découvrir ce quartier,"
    : "Au plaisir de vous faire découvrir ce coin de Paris,";
  // Salutation : le prénom renseigné dans le formulaire, sinon (réservations
  // anciennes) le premier mot du nom complet.
  const given = cleanText_(booking.firstName, 60) || firstName_(booking.name);
  const greeting = given ? `Bonjour ${given},` : "Bonjour,";
  const lines = [greeting, "", "Merci pour votre réservation ! Voici le récapitulatif :", ""]
    .concat(recap)
    .concat([
      "",
      meetingLine_(booking.sheet),
      "",
      "Pour annuler ou modifier, répondez simplement à cet e-mail en rappelant votre référence.",
      "",
      "Toutes les réponses (rendez-vous, tarifs, annulation, météo) : " + sitePageUrl_("faq.html"),
      "Le programme et les places restantes : " + siteUrl_(),
      "",
      closing,
      "",
      "Marie-Tiyi Jalon",
      `Téléphone : ${guidePhone_()}`,
      contactEmail_(),
    ]);
  const html = ['<div style="font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#242a23">',
    `<p style="margin:0 0 1em">${escapeHtml_(greeting)}</p>`,
    '<p style="margin:0 0 1em">Merci pour votre réservation ! Voici le récapitulatif :</p>',
    '<ul style="margin:0 0 1em;padding-left:1.2em">',
  ]
    .concat(recap.map((line) => `<li>${escapeHtml_(line.slice(2))}</li>`))
    .concat([
      "</ul>",
      `<p style="margin:0 0 1em">${escapeHtml_(meetingLine_(booking.sheet))}</p>`,
      '<p style="margin:0 0 1em">Pour annuler ou modifier, répondez simplement à cet e-mail en rappelant votre référence.</p>',
      `<p style="margin:0 0 1em">Toutes les réponses (rendez-vous, tarifs, annulation, météo)&nbsp;: <a href="${escapeHtml_(sitePageUrl_("faq.html"))}" style="color:#183e30">la page Questions fréquentes</a>.<br>Le programme et les places restantes&nbsp;: <a href="${escapeHtml_(siteUrl_())}" style="color:#183e30">le site des Balades Culturelles</a>.</p>`,
      `<p style="margin:0 0 1em">${escapeHtml_(closing)}</p>`,
      '<p style="margin:0">Marie-Tiyi Jalon<br>',
      `Téléphone : <a href="tel:${escapeHtml_(telHref_(guidePhone_()))}" style="color:#183e30">${escapeHtml_(guidePhone_())}</a><br>`,
      `${escapeHtml_(contactEmail_())}</p>`,
      "</div>",
    ])
    .join("");
  return {
    subject: `Votre balade est réservée — ${session.walk}, ${longDate}`,
    text: lines.join("\n"),
    html: html,
  };
}

/** Case jaune de la fiche de la date (B4) : le lieu de rendez-vous, s’il est déjà noté. */
function meetingPlace_(sheet) {
  try {
    return cleanText_(sheet.getRange(MEETING_CELL).getValue(), 300);
  } catch (error) {
    return "";
  }
}

function meetingLine_(sheet) {
  const meeting = meetingPlace_(sheet);
  return meeting ? `Lieu de rendez-vous : ${meeting}` : MEETING_FALLBACK;
}

/** Prénom utilisé dans le corps du message (« Camille Martin » → « Camille »). */
function firstName_(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first.length >= 2 ? first : "";
}

/** Nom affiché d’un client : prénom + nom, ou le nom seul (réservations anciennes). */
function displayName_(firstName, name) {
  const first = cleanText_(firstName, 60);
  const last = cleanText_(name, 100);
  return first ? `${first} ${last}`.trim() : last;
}

/** Montant à la française : 15,50 au lieu de 15.5. */
function frenchAmount_(amount) {
  const value = Number(amount) || 0;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
}

/** Le nom saisi par le visiteur ne doit pas casser l’en-tête de l’e-mail. */
function quoteName_(name) {
  return `"${String(name || "").replace(/["\\]/g, " ").trim()}"`;
}

function escapeHtml_(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/* Comptabilité : suivi des encaissements                             */
/* ------------------------------------------------------------------ */

/*
 * Principe : la fiche d’une date reste la source de vérité. Chaque participant
 * peut porter deux versements (montant + date + moyen) et un remboursement.
 * Le moteur en tire des « mouvements » datés, qu’il reporte dans le tableur
 * privé « Comptabilité — Balades Culturelles » sans jamais compter deux fois
 * le même versement (identifiant stable = référence de réservation + clé).
 */

/** Tableur privé de comptabilité, rangé dans le dossier des réservations. */
function getAccounting_(root) {
  const known = openIfAlive_(props_().getProperty("ACCOUNTING_ID"));
  if (known) return known;
  let book = findSpreadsheet_(root, ACCOUNTING_NAME);
  if (!book) book = createSpreadsheetIn_(root, ACCOUNTING_NAME);
  props_().setProperty("ACCOUNTING_ID", book.getId());
  return book;
}

/** Onglet du tableur comptable, créé au besoin avec ses titres. */
function accountingSheet_(book, name, headers) {
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0]
    .map((value) => String(value == null ? "" : value));
  if (current.join("|") !== headers.join("|")) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()])
      .setFontWeight("bold").setFontColor(COLORS.white).setBackground(COLORS.forest)
      .setVerticalAlignment("middle");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function setupAccounting_(book) {
  const sheets = book.getSheets();
  if (!book.getSheetByName(ACCOUNTING_MOVEMENTS) && sheets.length === 1) sheets[0].setName(ACCOUNTING_MOVEMENTS);
  accountingSheet_(book, ACCOUNTING_MOVEMENTS, MOVEMENT_HEADERS);
  accountingSheet_(book, ACCOUNTING_FILES, FILES_HEADERS);
  accountingSheet_(book, ACCOUNTING_UNPAID, UNPAID_HEADERS);
  accountingSheet_(book, ACCOUNTING_ALERTS, ALERT_HEADERS);
  const summary = accountingSheet_(book, ACCOUNTING_SUMMARY, SUMMARY_HEADERS);
  // Titre et rappel : le solde de suivi n'est pas un chiffre d'affaires à déclarer.
  summary.getRange("A1").setValue("Synthèse mensuelle — encaissements et remboursements")
    .setFontSize(16).setFontWeight("bold").setFontColor(COLORS.forest);
  summary.getRange("A2").setValue(
    "Mois calculés sur la date des paiements et des remboursements. Le solde de suivi est un "
    + "indicatif de gestion : il ne correspond pas automatiquement au chiffre d’affaires à déclarer.",
  ).setFontColor(COLORS.muted);
  summary.getRange(1, 1, 1, SUMMARY_HEADERS.length).clearContent();
  summary.getRange(3, 1, 1, SUMMARY_HEADERS.length).setValues([SUMMARY_HEADERS.slice()])
    .setFontWeight("bold").setFontColor(COLORS.white).setBackground(COLORS.forest)
    .setVerticalAlignment("middle");
  summary.setFrozenRows(3);
}

/** Traitement complet : un seul passage, protégé par son propre verrou. */
function runAccountingSafely_() {
  try {
    const store = props_();
    const key = "accounting:run";
    const started = Number(store.getProperty(key) || 0);
    if (started && Date.now() - started < 300000) {
      console.warn("Suivi comptable : un traitement est déjà en cours.");
      return;
    }
    store.setProperty(key, String(Date.now()));
    try {
      runAccounting_();
    } finally {
      store.deleteProperty(key);
    }
  } catch (error) {
    // Une difficulté comptable ne doit jamais bloquer les réservations.
    console.error("Suivi comptable non mis à jour : " + error);
  }
}

function runAccounting_() {
  const root = getRootFolder_();
  const book = getAccounting_(root);
  setupAccounting_(book);
  const dashboardUrl = getDashboard_(root).getUrl();
  const files = collectVisitFiles_(book);
  const alerts = [];
  const computed = [];
  const unpaid = [];
  const seenReferences = {};

  files.forEach((file) => {
    const visit = openIfAlive_(file.fileId);
    if (!visit) {
      file.state = "Inaccessible";
      alerts.push({
        kind: "Fiche inaccessible",
        target: file.fileId,
        detail: `La fiche « ${file.walk || "?"} » (${file.date || "date inconnue"}) n’a pas pu être ouverte. Les montants déjà connus sont conservés.`,
      });
      return;
    }
    const sheet = visitSheet_(visit);
    const entries = readVisitEntries_(sheet);
    ensureVisitLayout_(sheet, file, dashboardUrl, sessionCapacityById_(`${file.date}|${file.walk}|${file.slot}`), entries);
    applyPaidShortcut_(sheet, entries, file);
    entries.forEach((entry) => {
      const values = entry.values;
      const reference = String(values[0] == null ? "" : values[0]).trim();
      const lastName = String(values[1] == null ? "" : values[1]).trim();
      const firstName = String(values[VISIT_COL.firstName - 1] == null ? "" : values[VISIT_COL.firstName - 1]).trim();
      const status = String(values[VISIT_COL.payment - 1] == null ? "" : values[VISIT_COL.payment - 1]).trim();
      const estimated = Number(values[VISIT_COL.estimated - 1]) || 0;
      let doublon = false;
      if (reference) {
        if (seenReferences[reference]) {
          doublon = true;
          alerts.push({
            kind: "Référence en double",
            target: reference,
            detail: `Cette référence apparaît dans deux fiches : seul le premier mouvement est compté (fiche « ${file.walk || "?"} »).`,
          });
        } else {
          seenReferences[reference] = true;
        }
      } else if (lastName) {
        alerts.push({
          kind: "Réservation sans référence",
          target: `${file.walk || "?"} — ${lastName}`,
          detail: "Cette ligne n’a pas de référence : son paiement est suivi par son nom. Ajoutez la référence BC-… pour un suivi stable.",
        });
      }
      // Une référence en double ne doit jamais être comptée deux fois.
      const movements = doublon ? [] : computeMovements_(entry, file, reference, firstName, lastName, alerts);
      computed.push.apply(computed, movements);
      const received = movements.reduce((total, movement) => {
        return total + (movement.type === "Remboursement" ? -movement.amount : movement.amount);
      }, 0);
      if (estimated > 0 && received < estimated) {
        unpaid.push([
          reference, displayName_(firstName, lastName), file.walk, file.date,
          estimated, received, Math.max(0, estimated - received), status || "Non payé",
        ]);
      }
    });
  });

  const movementsSheet = accountingSheet_(book, ACCOUNTING_MOVEMENTS, MOVEMENT_HEADERS);
  const rows = reconcileMovements_(readTabRows_(movementsSheet, MOVEMENT_HEADERS.length), computed, seenReferences);
  writeMovementRows_(movementsSheet, rows);
  writeMonthlySummary_(accountingSheet_(book, ACCOUNTING_SUMMARY, SUMMARY_HEADERS), rows);
  writeSimpleRows_(accountingSheet_(book, ACCOUNTING_UNPAID, UNPAID_HEADERS), unpaid);
  writeFilesRows_(accountingSheet_(book, ACCOUNTING_FILES, FILES_HEADERS), files);
  writeAlerts_(accountingSheet_(book, ACCOUNTING_ALERTS, ALERT_HEADERS), alerts);
}

/**
 * Fiches à suivre : celles connues du moteur et celles déjà enregistrées dans le
 * tableur comptable (une fiche retirée du programme reste suivie, et l’historique
 * comptable n’est jamais effacé).
 */
function collectVisitFiles_(book) {
  const files = [];
  const seen = {};
  const add = (fileId, info) => {
    if (!fileId || seen[fileId]) return;
    seen[fileId] = true;
    files.push({
      fileId: fileId,
      date: info.date || "",
      walk: info.walk || "",
      slot: info.slot || "",
      state: "Lue",
    });
  };
  const stored = props_().getProperties();
  Object.keys(stored).forEach((key) => {
    if (key.indexOf("visit:") !== 0) return;
    const record = parseVisit_(stored[key]);
    if (!record || !record.fileId) return;
    add(record.fileId, record);
  });
  const sheet = book.getSheetByName(ACCOUNTING_FILES);
  if (sheet) {
    readTabRows_(sheet, FILES_HEADERS.length).forEach((row) => {
      const fileId = String(row[0] == null ? "" : row[0]).trim();
      if (!fileId) return;
      add(fileId, { date: isoOf_(row[1]), walk: String(row[2] || ""), slot: String(row[3] || "") });
    });
  }
  return files;
}

/** Mouvements d’un participant : deux versements possibles et un remboursement. */
function computeMovements_(entry, file, reference, firstName, lastName, alerts) {
  const values = entry.values;
  const client = displayName_(firstName, lastName);
  const slots = [
    { key: "p1", label: "1er versement", type: "Encaissement", amount: values[VISIT_COL.amount - 1], date: values[VISIT_COL.payDate - 1], method: values[VISIT_COL.payMethod - 1] },
    { key: "p2", label: "2e versement", type: "Encaissement", amount: values[VISIT_COL.amount2 - 1], date: values[VISIT_COL.payDate2 - 1], method: values[VISIT_COL.payMethod2 - 1] },
    { key: "r1", label: "Remboursement", type: "Remboursement", amount: values[VISIT_COL.refund - 1], date: values[VISIT_COL.refundDate - 1], method: values[VISIT_COL.refundMethod - 1] },
  ];
  const movements = [];
  slots.forEach((slot) => {
    if (isEmptyCell_(slot.amount)) return;
    const amount = parseAmount_(slot.amount);
    if (amount === null) {
      alerts.push({
        kind: "Montant illisible",
        target: reference || client,
        detail: `Le ${slot.label.toLowerCase()} de ${client || "client sans nom"} n’est pas un montant : il n’est pas compté.`,
      });
      return;
    }
    const date = parseSheetDate_(slot.date);
    if (!date) {
      alerts.push({
        kind: "Montant sans date",
        target: reference || client,
        detail: `Le ${slot.label.toLowerCase()} de ${client || "client sans nom"} (${frenchAmount_(amount)} €) n’a pas de date : il n’est rattaché à aucun mois.`,
      });
      return;
    }
    movements.push({
      id: reference ? `${reference}|${slot.key}` : `${file.fileId}|${client}|${isoOf_(date)}|${slot.key}`,
      reference: reference,
      firstName: firstName,
      lastName: lastName,
      client: client,
      walk: file.walk,
      date: file.date,
      fileId: file.fileId,
      paidAt: date,
      type: slot.type,
      amount: amount,
      method: String(slot.method == null ? "" : slot.method).trim(),
    });
  });
  return movements;
}

/**
 * Réconciliation : un mouvement déjà connu est mis à jour sur place (jamais
 * dupliqué), un mouvement disparu d’une fiche lisible est signalé et neutralisé,
 * un mouvement dont la fiche a disparu est conservé tel quel.
 */
function reconcileMovements_(existing, computed, seenReferences) {
  const byId = {};
  computed.forEach((movement) => { byId[movement.id] = movement; });
  const rows = [];
  existing.forEach((row) => {
    const id = String(row[MOVEMENT_HEADERS.length - 2] == null ? "" : row[MOVEMENT_HEADERS.length - 2]);
    if (!id || byId[id]) return;
    const reference = String(row[0] == null ? "" : row[0]).trim();
    if (reference && seenReferences[reference]) {
      // La réservation existe encore mais le paiement a été retiré de la fiche.
      rows.push(row.slice(0, MOVEMENT_HEADERS.length - 3)
        .concat([MOVEMENT_CANCELLED, id, row[MOVEMENT_HEADERS.length - 1]]));
    } else {
      rows.push(row.slice());
    }
  });
  computed.forEach((movement) => {
    rows.push([
      movement.reference, movement.walk, movement.date ? sheetDate_(movement.date) : "",
      movement.client, movement.firstName, movement.lastName, movement.paidAt,
      movement.type, movement.amount, movement.method,
      MOVEMENT_ACTIVE, movement.id,
      movement.fileId ? `=HYPERLINK("https://docs.google.com/spreadsheets/d/${movement.fileId}/edit";"Ouvrir la fiche")` : "",
    ]);
  });
  rows.sort((a, b) => {
    const dateA = parseSheetDate_(a[6]);
    const dateB = parseSheetDate_(b[6]);
    const stampA = dateA ? dateA.getTime() : 0;
    const stampB = dateB ? dateB.getTime() : 0;
    return stampA - stampB
      || compare_(String(a[0] || ""), String(b[0] || ""))
      || compare_(String(a[7] || ""), String(b[7] || ""));
  });
  return rows;
}

function writeMovementRows_(sheet, rows) {
  const last = sheet.getLastRow();
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, MOVEMENT_HEADERS.length).setValues(rows);
    sheet.getRange(2, 3, rows.length, 1).setNumberFormat("dd/mm/yyyy");
    sheet.getRange(2, 7, rows.length, 1).setNumberFormat("dd/mm/yyyy");
    sheet.getRange(2, 9, rows.length, 1).setNumberFormat("0.00");
    const links = rows.map((row) => [row[MOVEMENT_HEADERS.length - 1] || ""]);
    sheet.getRange(2, MOVEMENT_HEADERS.length, rows.length, 1).setFormulas(links);
  }
  if (last > rows.length + 1) {
    sheet.getRange(rows.length + 2, 1, last - rows.length - 1, MOVEMENT_HEADERS.length).clearContent();
  }
  [150, 260, 120, 220, 130, 170, 120, 140, 110, 130, 100, 220, 150].forEach((size, index) => {
    sheet.setColumnWidth(index + 1, size);
  });
}

/** Synthèse mensuelle : les mois viennent des dates de paiement, pas des balades. */
function writeMonthlySummary_(sheet, rows) {
  const months = {};
  rows.forEach((row) => {
    if (String(row[10] || "") !== MOVEMENT_ACTIVE) return;
    const date = parseSheetDate_(row[6]);
    if (!date) return;
    const key = monthKey_(date);
    if (!months[key]) months[key] = { key: key, received: 0, refunded: 0 };
    const amount = Number(row[8]) || 0;
    if (String(row[7] || "") === "Remboursement") months[key].refunded += amount;
    else months[key].received += amount;
  });
  const keys = Object.keys(months).sort();
  const out = [];
  let year = "";
  let yearReceived = 0;
  let yearRefunded = 0;
  const flushYear = () => {
    if (!year) return;
    out.push([`Total ${year}`, round2_(yearReceived), round2_(yearRefunded), round2_(yearReceived - yearRefunded)]);
  };
  keys.forEach((key) => {
    const currentYear = key.slice(0, 4);
    if (year && currentYear !== year) flushYear();
    if (currentYear !== year) {
      year = currentYear;
      yearReceived = 0;
      yearRefunded = 0;
    }
    const item = months[key];
    yearReceived += item.received;
    yearRefunded += item.refunded;
    out.push([monthLabel_(key), round2_(item.received), round2_(item.refunded), round2_(item.received - item.refunded)]);
  });
  flushYear();
  let totalReceived = 0;
  let totalRefunded = 0;
  keys.forEach((key) => {
    totalReceived += months[key].received;
    totalRefunded += months[key].refunded;
  });
  if (keys.length) {
    out.push(["Total général", round2_(totalReceived), round2_(totalRefunded), round2_(totalReceived - totalRefunded)]);
  }
  const last = sheet.getLastRow();
  if (out.length) {
    sheet.getRange(4, 1, out.length, SUMMARY_HEADERS.length).setValues(out);
    sheet.getRange(4, 2, out.length, 3).setNumberFormat("0.00");
  }
  if (last > out.length + 3) {
    sheet.getRange(out.length + 4, 1, last - out.length - 3, SUMMARY_HEADERS.length).clearContent();
  }
  [220, 160, 160, 160].forEach((size, index) => sheet.setColumnWidth(index + 1, size));
}

/** Fiches suivies : le registre durable, indépendant des propriétés du script. */
function writeFilesRows_(sheet, files) {
  const rows = files.map((file) => [
    file.fileId, file.date ? sheetDate_(file.date) : "", file.walk, file.slot, todayParis_(), file.state || "Lue",
  ]);
  const last = sheet.getLastRow();
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, FILES_HEADERS.length).setValues(rows);
    sheet.getRange(2, 2, rows.length, 1).setNumberFormat("dd/mm/yyyy");
  }
  if (last > rows.length + 1) {
    sheet.getRange(rows.length + 2, 1, last - rows.length - 1, FILES_HEADERS.length).clearContent();
  }
  [260, 120, 260, 130, 120, 120].forEach((size, index) => sheet.setColumnWidth(index + 1, size));
}

/** Signalements : rien n’est effacé, un problème résolu passe simplement à « Réglé ». */
function writeAlerts_(sheet, alerts) {
  const existing = readTabRows_(sheet, ALERT_HEADERS.length);
  const keyOf = (row) => `${row[0]}|${row[1]}|${row[2]}`;
  const open = {};
  alerts.forEach((alert) => { open[`${alert.kind}|${alert.target}|${alert.detail}`] = true; });
  const rows = existing.map((row) => [
    row[0], row[1], row[2], row[3], open[keyOf(row)] ? ALERT_OPEN : ALERT_CLOSED,
  ]);
  alerts.forEach((alert) => {
    const key = `${alert.kind}|${alert.target}|${alert.detail}`;
    if (!rows.some((row) => keyOf(row) === key)) {
      rows.push([alert.kind, alert.target, alert.detail, sheetDate_(todayParis_()), ALERT_OPEN]);
    }
  });
  const last = sheet.getLastRow();
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, ALERT_HEADERS.length).setValues(rows);
    sheet.getRange(2, 4, rows.length, 1).setNumberFormat("dd/mm/yyyy");
  }
  if (last > rows.length + 1) {
    sheet.getRange(rows.length + 2, 1, last - rows.length - 1, ALERT_HEADERS.length).clearContent();
  }
  [200, 200, 420, 130, 100].forEach((size, index) => sheet.setColumnWidth(index + 1, size));
}

/* ------------------------------------------------------------------ */
/* Carnet d’adresses : lecture, fusion et écriture                    */
/* ------------------------------------------------------------------ */

function getContacts_(root) {
  const known = openIfAlive_(props_().getProperty("CONTACTS_ID"));
  if (known) return known;
  let book = findSpreadsheet_(root, CONTACTS_NAME);
  if (!book) book = createSpreadsheetIn_(root, CONTACTS_NAME);
  props_().setProperty("CONTACTS_ID", book.getId());
  return book;
}

/** Prépare l’onglet unique du carnet (titres, largeurs, formats, liste déroulante). */
function setupContacts_(book) {
  const sheets = book.getSheets();
  let sheet = book.getSheetByName(CONTACTS_SHEET);
  if (!sheet) {
    if (sheets.length === 1) sheet = sheets[0].setName(CONTACTS_SHEET);
    else sheet = book.insertSheet(CONTACTS_SHEET);
  }
  const width = CONTACT_HEADERS.length;
  sheet.setHiddenGridlines(true);
  sheet.getRange(CONTACTS_TITLE_ROW, 1).setValue("Carnet d’adresses — Balades Culturelles")
    .setFontSize(18).setFontWeight("bold").setFontColor(COLORS.forest);
  sheet.getRange(CONTACTS_SUMMARY_ROW, 1).setFontColor(COLORS.muted);
  sheet.getRange(CONTACTS_HEADER_ROW, 1, 1, width).setValues([CONTACT_HEADERS.slice()])
    .setFontWeight("bold").setFontColor(COLORS.white).setBackground(COLORS.forest)
    .setVerticalAlignment("middle");
  sheet.setRowHeight(CONTACTS_HEADER_ROW, 32);
  sheet.setFrozenRows(CONTACTS_HEADER_ROW);
  const rows = Math.max(1, sheet.getMaxRows() - CONTACTS_FIRST_ROW + 1);
  sheet.getRange(CONTACTS_FIRST_ROW, CONTACT_COL.firstVisit, rows, 2).setNumberFormat("dd/mm/yyyy");
  sheet.getRange(CONTACTS_FIRST_ROW, CONTACT_COL.addedAt, rows, 1).setNumberFormat("dd/mm/yyyy hh:mm");
  sheet.getRange(CONTACTS_FIRST_ROW, CONTACT_COL.visits, rows, 2).setNumberFormat("0");
  sheet.getRange(CONTACTS_FIRST_ROW, CONTACT_COL.optOut, rows, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Oui"], true).setAllowInvalid(true).build());
  // Une personne écartée reste visible mais grisée : rien n’est jamais effacé.
  const optOutRange = sheet.getRange(CONTACTS_FIRST_ROW, CONTACT_COL.optOut, rows, 1);
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Oui")
      .setFontColor("#9a9a92").setItalic(true).setRanges([optOutRange]).build(),
  ]);
  [110, 120, 140, 230, 210, 150, 150, 120, 120, 75, 90, 80, 230, 110, 140, 120, 280]
    .forEach((size, index) => sheet.setColumnWidth(index + 1, size));
  return sheet;
}

/** Traitement complet : un seul passage, protégé par son propre verrou. */
function runContactsSafely_() {
  try {
    const store = props_();
    const key = "contacts:run";
    const started = Number(store.getProperty(key) || 0);
    if (started && Date.now() - started < 300000) {
      console.warn("Carnet d’adresses : un traitement est déjà en cours.");
      return;
    }
    store.setProperty(key, String(Date.now()));
    try {
      runContacts_();
    } finally {
      store.deleteProperty(key);
    }
  } catch (error) {
    // Un souci sur le carnet ne doit jamais bloquer une réservation ni les e-mails.
    console.error("Carnet d’adresses non mis à jour : " + error);
  }
}

function runContacts_() {
  const root = getRootFolder_();
  const book = getContacts_(root);
  const sheet = setupContacts_(book);
  const existing = readExistingContacts_(sheet);
  const contacts = buildContacts_(root, existing);
  writeContacts_(sheet, contacts);
}

/** Contacts déjà enregistrés : identité et colonnes tenues à la main sont conservées. */
function readExistingContacts_(sheet) {
  const last = sheet.getLastRow();
  if (last < CONTACTS_FIRST_ROW) return [];
  const rows = sheet.getRange(CONTACTS_FIRST_ROW, 1, last - CONTACTS_FIRST_ROW + 1, CONTACT_HEADERS.length).getValues();
  const contacts = [];
  const seen = {};
  rows.forEach((values) => {
    const key = String(values[CONTACT_COL.key - 1] == null ? "" : values[CONTACT_COL.key - 1]).trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    contacts.push({
      key: key,
      firstName: textCell_(values[CONTACT_COL.firstName - 1]),
      lastName: textCell_(values[CONTACT_COL.lastName - 1]),
      email: textCell_(values[CONTACT_COL.email - 1]),
      altEmails: splitContactsList_(values[CONTACT_COL.altEmails - 1]),
      phone: phoneText_(values[CONTACT_COL.phone - 1]),
      altPhones: splitContactsList_(values[CONTACT_COL.altPhones - 1]),
      addedAt: parseSheetDate_(values[CONTACT_COL.addedAt - 1]),
      optOut: /^oui$/i.test(textCell_(values[CONTACT_COL.optOut - 1])),
      notes: textCell_(values[CONTACT_COL.notes - 1]),
      touched: false,
      sessions: new Map(),
      cancelled: 0,
      stage: textCell_(values[CONTACT_COL.stage - 1]),
      lastBookingSort: "",
      legacy: {
        visits: Number(values[CONTACT_COL.visits - 1]) || 0,
        people: Number(values[CONTACT_COL.people - 1]) || 0,
        walks: Number(values[CONTACT_COL.walks - 1]) || 0,
        firstDate: isoOf_(values[CONTACT_COL.firstVisit - 1]),
        lastDate: isoOf_(values[CONTACT_COL.lastVisit - 1]),
        lastWalk: textCell_(values[CONTACT_COL.lastWalk - 1]),
      },
    });
  });
  return contacts;
}

/**
 * Rassemble toutes les réservations connues (fiches de dates, journal, registre
 * comptable) puis fusionne les personnes qui partagent un e-mail ou un téléphone.
 */
function buildContacts_(root, existing) {
  const records = new Map();
  const emailOwners = new Map();
  const phoneOwners = new Map();
  existing.forEach((record) => {
    records.set(record.key, record);
    [record.email].concat(record.altEmails).forEach((email) => {
      const normalized = normalizeEmail_(email);
      if (normalized && !emailOwners.has(normalized)) emailOwners.set(normalized, record.key);
    });
    [record.phone].concat(record.altPhones).forEach((phone) => {
      const normalized = normalizePhone_(phone);
      if (normalized && !phoneOwners.has(normalized)) phoneOwners.set(normalized, record.key);
    });
  });

  const bookings = collectContactBookings_(root);
  bookings.forEach((booking) => {
    addContactBooking_(records, emailOwners, phoneOwners, booking);
  });

  return [...records.values()];
}

/**
 * Toutes les réservations à prendre en compte. Les fiches de dates font foi ;
 * le journal sert à retrouver les fiches et à ne pas oublier une réservation
 * dont la fiche aurait été supprimée ou déplacée.
 */
function collectContactBookings_(root) {
  const sources = [];
  const seenFiles = {};
  const addSource = (fileId, info) => {
    if (!fileId || seenFiles[fileId]) return;
    seenFiles[fileId] = true;
    sources.push({
      fileId: fileId,
      date: info.date || "",
      walk: info.walk || "",
      slot: info.slot || "",
    });
  };

  // 1. Fiches retenues par le moteur.
  const stored = props_().getProperties();
  Object.keys(stored).forEach((key) => {
    if (key.indexOf("visit:") !== 0) return;
    const record = parseVisit_(stored[key]);
    if (record && record.fileId) addSource(record.fileId, record);
  });

  // 2. Registre des fiches suivi par la comptabilité (survit au nettoyage).
  const accounting = openIfAlive_(stored.ACCOUNTING_ID);
  if (accounting) {
    const registry = accounting.getSheetByName(ACCOUNTING_FILES);
    if (registry) {
      readTabRows_(registry, FILES_HEADERS.length).forEach((row) => {
        addSource(String(row[0] == null ? "" : row[0]).trim(), {
          date: isoOf_(row[1]),
          walk: textCell_(row[2]),
          slot: textCell_(row[3]),
        });
      });
    }
  }

  // 3. Journal : source historique complète, et lien direct vers chaque fiche.
  const dashboard = openIfAlive_(stored.DASHBOARD_ID) || findSpreadsheet_(root, DASHBOARD_NAME);
  const journalRows = [];
  if (dashboard) {
    const journal = dashboard.getSheetByName(JOURNAL_SHEET);
    if (journal && journal.getLastRow() > 1) {
      const journalRange = journal.getRange(2, 1, journal.getLastRow() - 1, JOURNAL_HEADERS.length);
      const journalValues = journalRange.getValues();
      // La colonne « Fiche de la date » contient un lien =HYPERLINK(...) : getValues()
      // renvoie son texte affiché (« Ouvrir la fiche »), la formule est dans getFormulas().
      const journalFormulas = journalRange.getFormulas();
      journalValues.forEach((row, index) => {
        const date = isoOf_(row[1]);
        const walk = textCell_(row[2]);
        const slot = textCell_(row[3]);
        if (!date || !walk) return;
        const fileId = fileIdFromLink_(journalFormulas[index][10]) || fileIdFromLink_(row[10]);
        if (fileId) addSource(fileId, { date: date, walk: walk, slot: slot });
        journalRows.push({
          reference: textCell_(row[4]),
          createdAt: parseSheetDate_(row[0]),
          firstName: textCell_(row[12]),
          lastName: textCell_(row[5]),
          email: textCell_(row[6]),
          phone: phoneText_(row[7]),
          people: Number(row[8]) || 0,
          status: "",
          date: date,
          walk: walk,
          slot: slot,
          source: "journal",
        });
      });
    }
  }

  const bookings = [];
  const seenReferences = {};
  sources.forEach((source) => {
    const visit = openIfAlive_(source.fileId);
    if (!visit) return;
    const session = {
      id: `${source.date}|${source.walk}|${source.slot}`,
      date: source.date,
      walk: source.walk,
      slot: source.slot,
    };
    readVisitEntries_(visitSheet_(visit)).forEach((entry) => {
      const values = entry.values;
      const reference = textCell_(values[0]);
      if (reference) {
        if (seenReferences[reference]) return;
        seenReferences[reference] = true;
      }
      const people = Number(values[VISIT_COL.people - 1]) || 0;
      if (people <= 0) return;
      bookings.push({
        reference: reference,
        firstName: textCell_(values[VISIT_COL.firstName - 1]),
        lastName: textCell_(values[1]),
        email: textCell_(values[2]),
        phone: phoneText_(values[3]),
        people: people,
        status: textCell_(values[VISIT_COL.status - 1]) || TO_CONTACT,
        createdAt: parseSheetDate_(values[VISIT_COL.createdAt - 1]),
        date: session.date,
        walk: session.walk,
        slot: session.slot,
        sessionId: session.id,
        source: "fiche",
      });
    });
  });

  // Réservations présentes au journal mais dont la fiche n’est plus lisible.
  journalRows.forEach((row) => {
    if (row.people <= 0) return;
    if (row.reference && seenReferences[row.reference]) return;
    if (row.reference) seenReferences[row.reference] = true;
    bookings.push(Object.assign({ sessionId: `${row.date}|${row.walk}|${row.slot}` }, row));
  });

  // Ordre chronologique : la dernière réservation donne l’étape affichée.
  return bookings.sort((a, b) => compare_(a.date, b.date)
    || compare_(bookingTime_(a), bookingTime_(b))
    || compare_(a.reference, b.reference));
}

function bookingTime_(booking) {
  return booking.createdAt instanceof Date ? booking.createdAt.getTime() : 0;
}

/** Ajoute une réservation au bon contact, sans jamais créer de doublon. */
function addContactBooking_(records, emailOwners, phoneOwners, booking) {
  const email = normalizeEmail_(booking.email);
  const phone = normalizePhone_(booking.phone);
  if (!email && !phone) return; // sans coordonnée, la personne n’est pas joignable

  const byEmail = email ? emailOwners.get(email) : "";
  const byPhone = phone ? phoneOwners.get(phone) : "";
  let key = byEmail || byPhone;
  if (byEmail && byPhone && byEmail !== byPhone) {
    // Le même e-mail et le même téléphone désignent deux fiches : on les réunit.
    key = mergeContactRecords_(records, byEmail, byPhone, emailOwners, phoneOwners);
  }
  if (!key) {
    key = contactKeyFor_(records, email, phone);
    records.set(key, newContactRecord_(key));
  }
  const record = records.get(key);

  // Première réservation connue pour ce contact : les compteurs repartent de zéro.
  record.touched = true;
  const receivedAt = booking.createdAt instanceof Date
    ? booking.createdAt
    : (booking.date ? sheetDate_(booking.date) : null);
  if (receivedAt && (!(record.addedAt instanceof Date) || receivedAt < record.addedAt)) {
    record.addedAt = receivedAt;
  }
  if (!record.firstName && booking.firstName) record.firstName = booking.firstName;
  if (!record.lastName && booking.lastName) record.lastName = booking.lastName;
  if (!record.phone && booking.phone) {
    record.phone = booking.phone;
    if (phone && !phoneOwners.has(phone)) phoneOwners.set(phone, key);
  }
  if (!record.email && booking.email) {
    record.email = booking.email;
    if (email && !emailOwners.has(email)) emailOwners.set(email, key);
  }
  if (email && normalizeEmail_(record.email) !== email && !record.altEmails.some((item) => normalizeEmail_(item) === email)) {
    record.altEmails.push(booking.email);
    emailOwners.set(email, key);
  }
  if (phone && normalizePhone_(record.phone) !== phone && !record.altPhones.some((item) => normalizePhone_(item) === phone)) {
    record.altPhones.push(booking.phone);
    phoneOwners.set(phone, key);
  }

  if (booking.status === CANCELLED) {
    record.cancelled += 1;
  } else {
    const current = record.sessions.get(booking.sessionId);
    if (current) current.people += booking.people;
    else {
      record.sessions.set(booking.sessionId, {
        date: booking.date,
        walk: booking.walk,
        slot: booking.slot,
        people: booking.people,
        sort: bookingTime_(booking),
      });
    }
  }
  const sortKey = `${booking.date}T${String(bookingTime_(booking)).padStart(14, "0")}`;
  if (sortKey >= record.lastBookingSort) {
    record.lastBookingSort = sortKey;
    record.stage = booking.status || TO_CONTACT;
  }
}

function newContactRecord_(key) {
  return {
    key: key,
    firstName: "",
    lastName: "",
    email: "",
    altEmails: [],
    phone: "",
    altPhones: [],
    addedAt: null,
    optOut: false,
    notes: "",
    touched: true,
    sessions: new Map(),
    cancelled: 0,
    stage: "",
    lastBookingSort: "",
    legacy: { visits: 0, people: 0, walks: 0, firstDate: "", lastDate: "", lastWalk: "" },
  };
}

/** Fusionne deux contacts qui s’avèrent être la même personne. */
function mergeContactRecords_(records, keyA, keyB, emailOwners, phoneOwners) {
  const target = records.get(keyA);
  const source = records.get(keyB);
  if (!target) return keyB;
  if (!source) return keyA;
  const bothUntouched = !target.touched && !source.touched;
  if (bothUntouched && source.legacy) {
    target.legacy.visits += source.legacy.visits;
    target.legacy.people += source.legacy.people;
    target.legacy.walks += source.legacy.walks;
    if (source.legacy.firstDate && (!target.legacy.firstDate || source.legacy.firstDate < target.legacy.firstDate)) {
      target.legacy.firstDate = source.legacy.firstDate;
    }
    if (source.legacy.lastDate && source.legacy.lastDate > target.legacy.lastDate) {
      target.legacy.lastDate = source.legacy.lastDate;
      target.legacy.lastWalk = source.legacy.lastWalk;
    }
  }
  target.touched = target.touched || source.touched;
  target.firstName = target.firstName || source.firstName;
  target.lastName = target.lastName || source.lastName;
  if (!target.email) target.email = source.email;
  else if (source.email && normalizeEmail_(target.email) !== normalizeEmail_(source.email)
    && !target.altEmails.some((item) => normalizeEmail_(item) === normalizeEmail_(source.email))) {
    target.altEmails.push(source.email);
  }
  if (!target.phone) target.phone = source.phone;
  else if (source.phone && normalizePhone_(target.phone) !== normalizePhone_(source.phone)
    && !target.altPhones.some((item) => normalizePhone_(item) === normalizePhone_(source.phone))) {
    target.altPhones.push(source.phone);
  }
  source.altEmails.forEach((email) => {
    if (normalizeEmail_(email) !== normalizeEmail_(target.email)
      && !target.altEmails.some((item) => normalizeEmail_(item) === normalizeEmail_(email))) target.altEmails.push(email);
    emailOwners.set(normalizeEmail_(email), keyA);
  });
  source.altPhones.forEach((phone) => {
    if (normalizePhone_(phone) !== normalizePhone_(target.phone)
      && !target.altPhones.some((item) => normalizePhone_(item) === normalizePhone_(phone))) target.altPhones.push(phone);
    phoneOwners.set(normalizePhone_(phone), keyA);
  });
  source.sessions.forEach((session, id) => {
    const current = target.sessions.get(id);
    if (current) current.people += session.people;
    else target.sessions.set(id, session);
  });
  target.cancelled += source.cancelled;
  if (source.lastBookingSort > target.lastBookingSort) {
    target.lastBookingSort = source.lastBookingSort;
    target.stage = source.stage;
  }
  if (source.addedAt instanceof Date && (!(target.addedAt instanceof Date) || source.addedAt < target.addedAt)) {
    target.addedAt = source.addedAt;
  }
  target.optOut = target.optOut || source.optOut;
  if (source.notes && source.notes !== target.notes) target.notes = target.notes ? `${target.notes}\n${source.notes}` : source.notes;
  [source.email].concat(source.altEmails).forEach((email) => {
    const normalized = normalizeEmail_(email);
    if (normalized) emailOwners.set(normalized, keyA);
  });
  [source.phone].concat(source.altPhones).forEach((phone) => {
    const normalized = normalizePhone_(phone);
    if (normalized) phoneOwners.set(normalized, keyA);
  });
  records.delete(keyB);
  return keyA;
}

/** Clé stable dérivée de l’e-mail (ou du téléphone) : la même personne garde la même ligne. */
function contactKeyFor_(records, email, phone) {
  const basis = email || phone;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, basis, Utilities.Charset.UTF_8);
  const base = "C-" + digest.slice(0, 6).map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0")).join("").toUpperCase();
  let key = base;
  let suffix = 2;
  while (records.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  return key;
}

/** Écrit le carnet trié : dernière visite la plus récente en haut. */
function writeContacts_(sheet, records) {
  const rows = records.map((record) => contactRow_(record)).filter(Boolean);
  rows.sort((a, b) => {
    const dateA = a.dateSort || "";
    const dateB = b.dateSort || "";
    if (dateA !== dateB) return dateA < dateB ? 1 : -1;
    return compare_(`${a.lastName} ${a.firstName}`.toLowerCase(), `${b.lastName} ${b.firstName}`.toLowerCase());
  });
  const values = rows.map((row) => row.values);
  const last = sheet.getLastRow();
  if (values.length) {
    sheet.getRange(CONTACTS_FIRST_ROW, 1, values.length, CONTACT_HEADERS.length).setValues(values);
    sheet.getRange(CONTACTS_FIRST_ROW, CONTACT_COL.firstVisit, values.length, 2).setNumberFormat("dd/mm/yyyy");
    sheet.getRange(CONTACTS_FIRST_ROW, CONTACT_COL.addedAt, values.length, 1).setNumberFormat("dd/mm/yyyy hh:mm");
  }
  if (last > values.length + CONTACTS_FIRST_ROW - 1) {
    sheet.getRange(CONTACTS_FIRST_ROW + values.length, 1, last - values.length - CONTACTS_FIRST_ROW + 1, CONTACT_HEADERS.length).clearContent();
  }
  const today = todayParis_();
  const month = today.slice(0, 7);
  const visited = rows.filter((row) => row.visits > 0).length;
  const fresh = rows.filter((row) => row.addedAt instanceof Date && isoOf_(row.addedAt).slice(0, 7) === month).length;
  const optedOut = rows.filter((row) => row.optOut).length;
  const cancelled = rows.reduce((total, row) => total + row.cancelled, 0);
  const details = [
    `${rows.length} contact${rows.length > 1 ? "s" : ""}`,
    `${visited} déjà venu${visited > 1 ? "s" : ""} en visite`,
    `${fresh} nouveau${fresh > 1 ? "x" : ""} ce mois-ci`,
  ];
  if (cancelled) details.push(`${cancelled} réservation${cancelled > 1 ? "s" : ""} annulée${cancelled > 1 ? "s" : ""}`);
  if (optedOut) details.push(`${optedOut} à ne pas contacter`);
  sheet.getRange(CONTACTS_SUMMARY_ROW, 1)
    .setValue(`${details.join(" · ")} · mis à jour le ${Utilities.formatDate(new Date(), TIME_ZONE, "dd/MM/yyyy 'à' HH:mm")}`)
    .setFontWeight("bold").setFontColor(optedOut ? COLORS.clay : COLORS.forest);
  sheet.getRange(CONTACTS_SUMMARY_ROW + 1, 1)
    .setValue("Une personne déjà présente n’est jamais réajoutée : seules ses visites sont mises à jour. "
      + "Une réservation annulée n’est pas comptée comme une visite. « Ne pas contacter » et « Vos notes » sont conservés.")
    .setFontColor(COLORS.muted);
}

function contactRow_(record) {
  const sessions = [...record.sessions.values()];
  const computed = record.touched;
  const visitDates = sessions.map((session) => session.date).filter(Boolean).sort();
  const walks = [...new Set(sessions.map((session) => session.walk).filter(Boolean))];
  const lastSession = sessions.slice().sort((a, b) => compare_(a.date, b.date) || (a.sort - b.sort))[sessions.length - 1];
  const firstDate = computed ? (visitDates[0] || "") : record.legacy.firstDate;
  const lastDate = computed ? (visitDates[visitDates.length - 1] || "") : record.legacy.lastDate;
  const visits = computed ? sessions.length : record.legacy.visits;
  const people = computed ? sessions.reduce((total, session) => total + session.people, 0) : record.legacy.people;
  const walkCount = computed ? walks.length : record.legacy.walks;
  const lastWalk = computed ? (lastSession ? lastSession.walk : "") : record.legacy.lastWalk;
  const addedAt = record.addedAt instanceof Date ? record.addedAt : null;
  return {
    dateSort: lastDate || "",
    visits: visits,
    cancelled: record.cancelled,
    addedAt: addedAt,
    optOut: record.optOut,
    firstName: record.firstName,
    lastName: record.lastName,
    values: [
      record.key,
      safeSheetText_(record.firstName),
      safeSheetText_(record.lastName),
      safeSheetText_(record.email),
      safeSheetText_(record.altEmails.join(", ")),
      phoneCell_(record.phone),
      phoneCell_(record.altPhones.join(", ")),
      firstDate ? sheetDate_(firstDate) : "",
      lastDate ? sheetDate_(lastDate) : "",
      visits,
      people,
      walkCount,
      safeSheetText_(lastWalk),
      safeSheetText_(record.stage),
      addedAt || "",
      record.optOut ? "Oui" : "",
      safeSheetText_(record.notes),
    ],
  };
}

/** Extrait l’identifiant d’une fiche depuis un lien =HYPERLINK(...). */
function fileIdFromLink_(value) {
  const match = String(value == null ? "" : value).match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return match ? match[1] : "";
}

function textCell_(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return isoOf_(value);
  return String(value).trim();
}

function phoneText_(value) {
  return textCell_(value).replace(/^'/, "");
}

function splitContactsList_(value) {
  return textCell_(value).split(/[,;]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeEmail_(value) {
  return textCell_(value).toLowerCase();
}

/** Même numéro écrit 06 12…, +33 6 12… ou 0033 6 12… : une seule clé. */
function normalizePhone_(value) {
  let digits = textCell_(value).replace(/\D/g, "");
  if (digits.indexOf("00") === 0) digits = digits.slice(2);
  if (digits.length === 11 && digits.indexOf("33") === 0) digits = "0" + digits.slice(2);
  return digits.length >= 8 ? digits : "";
}

/** Lignes d’un onglet (hors ligne de titres). */
function readTabRows_(sheet, width) {

  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, width).getValues()
    .filter((row) => row.some((cell) => String(cell == null ? "" : cell).trim() !== ""));
}

/** Écrit des lignes simples (impayés) à partir de la ligne 2. */
function writeSimpleRows_(sheet, rows) {
  const last = sheet.getLastRow();
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, UNPAID_HEADERS.length).setValues(rows);
    sheet.getRange(2, 4, rows.length, 1).setNumberFormat("dd/mm/yyyy");
    sheet.getRange(2, 5, rows.length, 3).setNumberFormat("0.00");
  }
  if (last > rows.length + 1) {
    sheet.getRange(rows.length + 2, 1, last - rows.length - 1, UNPAID_HEADERS.length).clearContent();
  }
  [150, 220, 260, 120, 140, 150, 150, 110].forEach((size, index) => sheet.setColumnWidth(index + 1, size));
}

/* ------------------------------------------------------------------ */
/* Outils du suivi comptable                                          */
/* ------------------------------------------------------------------ */

/** Une cellule vide : le vide ou le null — jamais le 0 saisi volontairement. */
function isEmptyCell_(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

/** Montant saisi : nombre, ou texte « 15,50 ». */
function parseAmount_(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value == null ? "" : value).trim().replace(",", ".");
  if (!text) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Date d’un mouvement : date de la fiche, ou texte « 14/11/2026 ». */
function parseSheetDate_(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12, 0, 0);
  const french = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (french) return new Date(Number(french[3]), Number(french[2]) - 1, Number(french[1]), 12, 0, 0);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Date au format court (AAAA-MM-JJ). */
function isoOf_(value) {
  const date = parseSheetDate_(value);
  if (!date) return "";
  return Utilities.formatDate(date, TIME_ZONE, "yyyy-MM-dd");
}

function monthKey_(date) {
  return Utilities.formatDate(date, TIME_ZONE, "yyyy-MM");
}

function monthLabel_(key) {
  const parts = key.split("-");
  const month = MONTHS[Number(parts[1]) - 1] || parts[1];
  return `${month} ${parts[0]}`;
}

function round2_(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Compteurs (places réservées par date)                              */
/* ------------------------------------------------------------------ */

/** Participants d’une fiche, avec leur numéro de ligne (suivi stable). */
function readVisitEntries_(sheet) {
  const last = sheet.getLastRow();
  if (last < VISIT_FIRST_ROW) return [];
  const rows = sheet.getRange(VISIT_FIRST_ROW, 1, last - VISIT_FIRST_ROW + 1, VISIT_HEADERS.length).getValues();
  const entries = [];
  rows.forEach((values, index) => {
    if (!isParticipantRow_(values)) return;
    entries.push({ row: VISIT_FIRST_ROW + index, values: values });
  });
  return entries;
}

/** Une ligne compte si elle a une référence, un nom ou des personnes. */
function isParticipantRow_(values) {
  if (String(values[0] == null ? "" : values[0]).trim() !== "") return true;
  if (String(values[1] == null ? "" : values[1]).trim() !== "") return true;
  if (Number(values[VISIT_COL.people - 1]) > 0) return true;
  return false;
}

function readVisitRows_(sheet) {
  return readVisitEntries_(sheet).map((entry) => entry.values);
}

/** Toute ligne avec un nombre de personnes occupe des places, sauf si elle est « Annulée ». */
function countStats_(rows) {
  return rows.reduce((stats, row) => {
    const people = Number(row[VISIT_COL.people - 1]) || 0;
    const status = String(row[VISIT_COL.status - 1] || "").trim();
    if (people <= 0 || status === CANCELLED) return stats;
    stats.booked += people;
    stats.bookings += 1;
    if (status === TO_CONTACT) stats.toContact += 1;
    return stats;
  }, { booked: 0, bookings: 0, toContact: 0 });
}

/** Relit la fiche de chaque date à venir (vos annulations et ajouts manuels sont pris en compte). */
function refreshUpcomingStats_() {
  const today = todayParis_();
  const store = props_();
  const stored = store.getProperties();
  Object.keys(stored).forEach((key) => {
    if (key.indexOf("visit:") !== 0) return;
    const record = parseVisit_(stored[key]);
    const statsKey = "stats:" + key.slice("visit:".length);
    // Date passée : plus rien à recompter (le tableau de bord garde les derniers chiffres).
    if (record && record.date && record.date < today) return;
    const visit = record && openIfAlive_(record.fileId);
    if (!visit) {
      // Fiche supprimée : elle sera recréée à la prochaine réservation.
      store.deleteProperty(key);
      store.deleteProperty(statsKey);
      return;
    }
    store.setProperty(statsKey, JSON.stringify(countStats_(readVisitRows_(visitSheet_(visit)))));
  });
}

/** Retrouve les fiches déjà présentes dans le Drive (par exemple après une réinstallation). */
function relinkVisitFiles_(root) {
  const stored = props_().getProperties();
  getProgram_().sessions.forEach((session) => {
    const record = parseVisit_(stored[propertyKey_("visit:", session.id)]);
    if (record && openIfAlive_(record.fileId)) return;
    const months = root.getFoldersByName(monthFolderName_(session.date));
    while (months.hasNext()) {
      const month = months.next();
      if (month.isTrashed()) continue;
      const visit = findSpreadsheet_(month, visitFileName_(session));
      if (visit) {
        writeVisit_(session, visit.getId());
        return;
      }
    }
  });
}

function writeStats_(sessionId, stats) {
  props_().setProperty(propertyKey_("stats:", sessionId), JSON.stringify(stats));
}

function parseStats_(value) {
  try {
    const stats = JSON.parse(value || "{}");
    return { booked: Number(stats.booked) || 0, bookings: Number(stats.bookings) || 0, toContact: Number(stats.toContact) || 0 };
  } catch (error) {
    return { booked: 0, bookings: 0, toContact: 0 };
  }
}

/**
 * Nettoie les compteurs des dates qui ne sont plus au programme : on les garde
 * 30 jours après la date (pour le tableau de bord), puis on les oublie.
 */
function pruneProperties_() {
  const program = getProgram_();
  if (!program.loaded) return;
  const inProgram = {};
  program.sessions.forEach((session) => { inProgram[propertyKey_("", session.id)] = true; });
  const keepFrom = isoDaysAgo_(REMOVED_KEEP_DAYS);
  const store = props_();
  const stored = store.getProperties();
  Object.keys(stored).forEach((key) => {
    // Le repère quotidien reste unique ; les comptes rendus sont oubliés après
    // 30 jours, quand leur date est passée et ne peut donc plus être envoyée.
    if (key === "mail:daily") return;
    // Réglages et repères du suivi comptable : jamais effacés par le nettoyage.
    if (key === "ACCOUNTING_ID" || key === "CONTACTS_ID" || key === "GUIDE_PHONE") return;
    if (key === "accounting:run" || key === "contacts:run" || key === "calendar:run") return;
    if (key === "CALENDAR_ID" || key === "CALENDAR_DISABLED") return;
    // L’événement d’une date passée reste dans l’agenda ; seul le lien interne est oublié.
    if (key.indexOf("calendar:") === 0) {
      const record = parseCalendarRecord_(stored[key]);
      if (!inProgram[key.slice("calendar:".length)] && (!record || !record.date || record.date < keepFrom)) {
        store.deleteProperty(key);
      }
      return;
    }
    if (key.indexOf("mail:visit:") === 0) {
      if (stored[key] < keepFrom) store.deleteProperty(key);
      return;
    }
    const isVisit = key.indexOf("visit:") === 0;
    const isStats = key.indexOf("stats:") === 0;
    if (!isVisit && !isStats) return;
    const hash = key.slice(6);
    if (inProgram[hash]) return;
    if (isVisit) {
      const record = parseVisit_(stored[key]);
      if (!record || !record.date || record.date < keepFrom) {
        store.deleteProperty(key);
        store.deleteProperty("stats:" + hash);
      }
    } else if (!stored["visit:" + hash]) {
      store.deleteProperty(key);
    }
  });
}

function installSyncTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "synchroniser")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("synchroniser").timeBased().everyMinutes(SYNC_EVERY_MINUTES).create();
}

/* ------------------------------------------------------------------ */
/* Utilitaires                                                        */
/* ------------------------------------------------------------------ */

function props_() {
  return PropertiesService.getScriptProperties();
}

/** Clé courte et stable pour une date du programme. */
function propertyKey_(prefix, sessionId) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sessionId, Utilities.Charset.UTF_8);
  return prefix + digest.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, "0")).join("");
}

/** Exécute une action sous verrou : deux réservations simultanées ne peuvent pas dépasser la capacité. */
function withLock_(timeout, action, options) {
  const lock = LockService.getScriptLock();
  if (options && options.optional) {
    if (!lock.tryLock(timeout)) return null;
  } else {
    try {
      lock.waitLock(timeout);
    } catch (error) {
      throw new Error("Le service de réservation est très sollicité. Réessayez dans un instant.");
    }
  }
  try {
    return action();
  } finally {
    lock.releaseLock();
  }
}

function compare_(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function isLabel_(value, maximum) {
  return typeof value === "string" && value.trim() !== "" && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
}

function todayParis_() {
  return Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd");
}

function isoDaysAgo_(days) {
  return Utilities.formatDate(new Date(Date.now() - days * 86400000), TIME_ZONE, "yyyy-MM-dd");
}

function isoDaysAhead_(days) {
  return Utilities.formatDate(new Date(Date.now() + days * 86400000), TIME_ZONE, "yyyy-MM-dd");
}

function parseIsoDate_(iso) {
  const parts = String(iso).split("-").map(Number);
  return { year: parts[0], month: parts[1], day: parts[2] };
}

// Une date reste affichée 24 h après la fin de la balade, puis disparaît du site.
const VISIBLE_HOURS_AFTER_END = 24;
const SLOT_TIME = /(\d{1,2})\s*(?:h|:)\s*(\d{1,2})?/;

/** Horaires (début, fin) d’un créneau « 10 h 30–12 h » ; 10 h 30–12 h par défaut. */
function slotBounds_(slot) {
  const parts = String(slot || "").split(/\s*[–—-]\s*/);
  const read = (value, fallback) => {
    const match = SLOT_TIME.exec(value || "");
    if (!match) return fallback;
    const hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    return hour <= 23 && minute <= 59 ? [hour, minute] : fallback;
  };
  const start = read(parts[0], [10, 30]);
  let end = read(parts[1], [12, 0]);
  if (end[0] * 60 + end[1] <= start[0] * 60 + start[1]) {
    end = [(start[0] + 1) % 24, start[1]];
  }
  return { start: start, end: end };
}

function sessionStartDate_(session) {
  const day = parseIsoDate_(session.date);
  const start = slotBounds_(session.slot).start;
  return new Date(day.year, day.month - 1, day.day, start[0], start[1], 0);
}

function sessionEndDate_(session) {
  const day = parseIsoDate_(session.date);
  const end = slotBounds_(session.slot).end;
  return new Date(day.year, day.month - 1, day.day, end[0], end[1], 0);
}

/** Vrai 24 h après la fin de la balade : la date n’est plus proposée ni affichée. */
function sessionHidden_(session, now) {
  const moment = now || Date.now();
  return moment >= sessionEndDate_(session).getTime() + VISIBLE_HOURS_AFTER_END * 3600000;
}

/** Date affichable dans Sheets (midi, pour éviter tout décalage de fuseau). */
function sheetDate_(iso) {
  const date = parseIsoDate_(iso);
  return new Date(date.year, date.month - 1, date.day, 12, 0, 0);
}

function longFrenchDate_(iso) {
  const date = parseIsoDate_(iso);
  const weekday = WEEKDAYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()];
  return `${weekday} ${date.day === 1 ? "1er" : date.day} ${MONTHS[date.month - 1].toLowerCase()} ${date.year}`;
}

function monthFolderName_(iso) {
  const date = parseIsoDate_(iso);
  return `${date.year}-${String(date.month).padStart(2, "0")} · ${MONTHS[date.month - 1]} ${date.year}`;
}

function visitFileName_(session) {
  return `${session.date} · ${session.walk} · ${session.slot}`;
}

function cleanText_(value, maximum) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().substring(0, maximum);
}

/** Empêche un texte saisi par un visiteur d’être interprété comme une formule. */
function safeSheetText_(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

/** L’apostrophe garde le téléphone en texte : sinon Sheets écrirait 612345678 au lieu de 0612345678. */
function phoneCell_(phone) {
  return phone ? "'" + phone : "";
}

function isValidEmail_(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Numéro de téléphone : formats français (06 12 34 56 78, 01 42 68 53 00) et
 * internationaux (+33 6 12 34 56 78, 0033…). On refuse l’absence et l’incomplet.
 */
function isValidPhone_(phone) {
  const text = String(phone || "").trim();
  if (!text) return false;
  if (!/^[0-9+ ().\-\/]+$/.test(text)) return false;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return false;
  if (/^0+$/.test(digits)) return false;
  return true;
}

function validateAgeGroups_(value, participants, capacity) {
  if (!value || typeof value !== "object") {
    throw new Error("Répartissez les personnes selon les tarifs affichés.");
  }
  const groups = {};
  PRICE_KEYS.forEach((key) => {
    const count = value[key];
    if (!Number.isInteger(count) || count < 0 || count > capacity) {
      throw new Error(`Chaque tranche tarifaire doit contenir un nombre entier entre 0 et ${capacity}.`);
    }
    groups[key] = count;
  });
  const total = PRICE_KEYS.reduce((sum, key) => sum + groups[key], 0);
  if (total !== participants || total < 1 || total > capacity) {
    throw new Error(`La répartition par tarif doit totaliser le nombre de personnes, dans la limite de ${capacity}.`);
  }
  if (groups.child + groups.underFive > 0 && !COMPANION_KEYS.some((key) => groups[key] > 0)) {
    throw new Error(CHILD_ALONE_MESSAGE);
  }
  return groups;
}
