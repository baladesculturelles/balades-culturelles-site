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
 * Chaque réservation confirmée envoie un e-mail au client depuis votre boîte, avec
 * une copie pour vous (nécessite l’autorisation « script.send_email » : voir README.md).
 *
 * Mise en route : exécutez une fois la fonction « installer », puis déployez le
 * projet en application Web (voir README.md).
 */

// Adresse du programme publié avec le site. Pour la changer sans toucher au code :
// Paramètres du projet → Propriétés du script → PROGRAMME_URL.
const PROGRAMME_URL = "https://baladesculturelles.github.io/balades-culturelles-site/programme.json";
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
const ENGINE_VERSION = "9fbbe0a3dc";

/* ------------------------------------------------------------------ */
/* E-mail de confirmation                                             */
/* ------------------------------------------------------------------ */

// Boîte de Marie-Tiyi : les confirmations partent de cette adresse et le client
// y répond directement. Pour la changer sans toucher au code :
// Paramètres du projet → Propriétés du script → CONTACT_EMAIL.
const CONTACT_EMAIL = "balades.culturelles@gmail.com";
const CONTACT_NAME = "Marie-Tiyi — Balades Culturelles";

// Case (fusionnée) où vous notez le point de rendez-vous dans la fiche d’une date.
const MEETING_CELL = "B4";
const MEETING_FALLBACK = "Le lieu de rendez-vous précis vous sera communiqué quelques jours avant la balade.";

// Balades dont le titre évoque un quartier : la formule de politesse parle alors
// du quartier. Pour les autres (cimetière, monuments, thème…), une variante neutre est utilisée.
const QUARTIER_WORDS = Object.freeze(["quartier", "village", "faubourg"]);

// Valeurs de secours tant que le programme du site n’a pas été lu.
const DEFAULT_CAPACITY = 20;
const DEFAULT_PRICES = Object.freeze({ standard: 15, youth: 12, child: 8, underFive: 0 });
const PRICE_KEYS = Object.freeze(["standard", "youth", "child", "underFive"]);

// Étapes de suivi d’une réservation. Seule « Annulée » libère les places.
const STATUSES = Object.freeze(["Confirmée", "Contactée", "Réalisée", "Annulée"]);
const TO_CONTACT = "Confirmée";
const CANCELLED = "Annulée";
const REMOVED_STATE = "Retirée du site";

const MONTHS = Object.freeze(["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]);
const WEEKDAYS = Object.freeze(["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"]);
const COLORS = Object.freeze({ forest: "#183e30", clay: "#b7654b", muted: "#686d62", paper: "#f3efe5", white: "#ffffff" });

// Fiche d’une date : en-tête sur les lignes 1 à 4, titres de colonnes en ligne 6, participants dès la ligne 7.
const VISIT_HEADER_ROW = 6;
const VISIT_FIRST_ROW = 7;
const VISIT_HEADERS = Object.freeze([
  "Référence", "Nom", "E-mail", "Téléphone", "Personnes",
  "Plein tarif (26 ans et +)", "Jeunes 15–25 ans", "Enfants 5–14 ans", "Moins de 5 ans",
  "Montant estimé (€)", "Étape", "Réservée le", "Message du client", "Vos notes",
]);
const VISIT_COL = Object.freeze({ people: 5, status: 11, createdAt: 12 });

// Tableau de bord : titre et résumé sur les lignes 1 à 3, titres de colonnes en ligne 5.
const DASHBOARD_HEADER_ROW = 5;
const DASHBOARD_FIRST_ROW = 6;
const DASHBOARD_HEADERS = Object.freeze([
  "Date", "Balade", "Horaire", "Réservations", "Personnes", "Places restantes", "État", "À contacter", "Fiche de la date",
]);
const JOURNAL_HEADERS = Object.freeze([
  "Réservée le", "Date de la balade", "Balade", "Horaire", "Référence", "Nom", "E-mail", "Téléphone",
  "Personnes", "Montant estimé (€)", "Fiche de la date",
]);

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
  const program = getProgram_();
  const opening = `C’est prêt : ouvrez le dossier « ${ROOT_FOLDER_NAME} » dans votre Google Drive.`;
  const message = program.loaded
    ? `${opening} Programme lu sur le site : ${program.sessions.length} dates.`
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
    writeDashboard_(getDashboard_(getRootFolder_()));
    return true;
  }, { optional: true });
  if (!done) return "Une réservation était en cours : nouvelle mise à jour au prochain passage.";
  return fetched.ok
    ? `Tableau de bord à jour (${getProgram_().sessions.length} dates lues sur le site).`
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
    const result = createBooking_({
      sessionId: body.session_id,
      name: body.name,
      email: body.email,
      phone: body.phone,
      message: body.message,
      participants: body.participants,
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

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

/** Places restantes par date à venir, lues dans les compteurs (aucun tableur ouvert : réponse rapide). */
function getAvailability_() {
  const program = getProgram_();
  const today = todayParis_();
  const stored = props_().getProperties();
  const sessions = program.sessions
    .filter((session) => session.date >= today)
    .map((session) => {
      const booked = parseStats_(stored[propertyKey_("stats:", session.id)]).booked;
      return {
        id: session.id,
        date: session.date,
        walk: session.walk,
        slot: session.slot,
        capacity: program.capacity,
        booked: booked,
        remaining: Math.max(0, program.capacity - booked),
      };
    });
  return { capacity: program.capacity, sessions: sessions };
}

/* ------------------------------------------------------------------ */
/* Programme lu sur le site                                           */
/* ------------------------------------------------------------------ */

function programmeUrl_() {
  return props_().getProperty("PROGRAMME_URL") || PROGRAMME_URL;
}

/** Programme enregistré lors de la dernière lecture réussie du site. */
function getProgram_() {
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
    const previous = getProgram_();
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
    sessions.push({ id: id, date: date, walk: walk, slot: slot });
  });
  if (!sessions.length) throw new Error("aucune date valide");
  if (sessions.length > 400) throw new Error("trop de dates");
  sessions.sort((a, b) => compare_(a.date, b.date) || compare_(a.walk, b.walk) || compare_(a.slot, b.slot));
  return { loaded: true, capacity: capacity, prices: prices, sessions: sessions, fetchedAt: "" };
}

function programSignature_(program) {
  return JSON.stringify([program.capacity, PRICE_KEYS.map((key) => program.prices[key]), program.sessions.map((session) => session.id)]);
}

/** Enregistre le programme en morceaux de texte ASCII (limite de 9 Ko par propriété). */
function storeProgram_(program) {
  const compact = {
    c: program.capacity,
    p: PRICE_KEYS.map((key) => program.prices[key]),
    s: program.sessions.map((session) => [session.date, session.walk, session.slot]),
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
    sessions: (compact.s || []).map((item) => ({ id: `${item[0]}|${item[1]}|${item[2]}`, date: item[0], walk: item[1], slot: item[2] })),
    fetchedAt: compact.t || "",
  };
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
  const name = cleanText_(payload.name, 100);
  const email = cleanText_(payload.email, 254);
  const phone = cleanText_(payload.phone, 40);
  const message = cleanText_(payload.message, 1000);
  const sessionId = cleanText_(payload.sessionId, 600);

  if (name.length < 2) throw new Error("Saisissez votre nom.");
  if (!isValidEmail_(email)) throw new Error("Saisissez une adresse e-mail valide.");
  if (phone && phone.replace(/\D/g, "").length < 6) throw new Error("Le numéro de téléphone semble incomplet.");

  let program = getProgram_();
  let session = program.sessions.find((item) => item.id === sessionId);
  if (!session && programAgeSeconds_() > 60) {
    // Date peut-être ajoutée sur le site depuis la dernière lecture du programme.
    refreshProgram_();
    program = getProgram_();
    session = program.sessions.find((item) => item.id === sessionId);
  }
  if (!session) throw new Error("Cette balade ou cette date n’est pas au programme.");
  if (session.date < todayParis_()) throw new Error("Cette date est passée. Choisissez une prochaine balade.");

  const capacity = program.capacity;
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
    const stats = countStats_(readVisitRows_(sheet));
    const remaining = capacity - stats.booked;
    if (participants > remaining) {
      throw new Error(`Il ne reste que ${Math.max(0, remaining)} place(s) pour cette visite. Choisissez une autre date ou réduisez le nombre de personnes.`);
    }

    const reference = "BC-" + Utilities.getUuid().replace(/-/g, "").substring(0, 12).toUpperCase();
    const createdAt = new Date();
    const row = Math.max(sheet.getLastRow() + 1, VISIT_FIRST_ROW);
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
        createdAt, reference, name, email, phone, participants, priceEstimate,
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
      email: email,
      session: session,
      participants: participants,
      priceEstimate: priceEstimate,
      sheet: sheet,
    });

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
  // Toujours à jour dans la fiche, même après une modification à la main.
  const booked = `SUMIFS(E${first}:E, K${first}:K, "<>${CANCELLED}")`;
  sheet.getRange("A3")
    .setFormula(`="Places : " & ${booked} & " réservées · " & (${capacity} - ${booked}) & " restantes sur ${capacity}"`)
    .setFontWeight("bold").setFontColor(COLORS.clay);
  sheet.getRange("A4").setValue("Lieu de rendez-vous :").setFontWeight("bold");
  sheet.getRange("B4:E4").merge().setBackground("#fff6dc")
    .setNote("Notez ici le point de rendez-vous de cette balade.");
  sheet.getRange("G4").setFormula(`=HYPERLINK("${dashboardUrl}", "← Tableau de bord")`).setFontWeight("bold");

  sheet.getRange(VISIT_HEADER_ROW, 1, 1, width).setValues([VISIT_HEADERS.slice()])
    .setFontWeight("bold").setFontColor(COLORS.white).setBackground(COLORS.forest)
    .setWrap(true).setVerticalAlignment("middle");
  sheet.setRowHeight(VISIT_HEADER_ROW, 40);
  sheet.setFrozenRows(VISIT_HEADER_ROW);

  const maxRows = sheet.getMaxRows();
  const dataRows = Math.max(1, maxRows - first + 1);
  sheet.getRange(first, VISIT_COL.status, dataRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(STATUSES.slice(), true)
      .setAllowInvalid(false)
      .setHelpText("Confirmée = à contacter · Contactée = point de rendez-vous envoyé · Réalisée · Annulée = places libérées.")
      .build(),
  );
  sheet.getRange(first, VISIT_COL.people, dataRows, 6).setNumberFormat("0");
  sheet.getRange(first, VISIT_COL.createdAt, dataRows, 1).setNumberFormat("dd/mm/yyyy hh:mm");

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

  [120, 170, 220, 130, 85, 95, 95, 95, 95, 95, 110, 130, 260, 220].forEach((size, index) => sheet.setColumnWidth(index + 1, size));
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
    const remaining = Math.max(0, program.capacity - stats.booked);
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
      record ? `=HYPERLINK("https://docs.google.com/spreadsheets/d/${record.fileId}/edit", "Ouvrir la fiche")` : "Pas encore de réservation",
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

  const first = DASHBOARD_FIRST_ROW;
  const previous = sheet.getLastRow() - first + 1;
  if (previous > rows.length) {
    sheet.getRange(first + rows.length, 1, previous - rows.length, DASHBOARD_HEADERS.length).clearContent();
  }
  if (rows.length) sheet.getRange(first, 1, rows.length, DASHBOARD_HEADERS.length).setValues(rows);
}

function addJournalRow_(dashboard, session, visitUrl, booking) {
  const sheet = dashboard.getSheetByName(JOURNAL_SHEET) || dashboard.insertSheet(JOURNAL_SHEET);
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
    `=HYPERLINK("${visitUrl}", "Ouvrir la fiche")`,
  ]]).setFontWeight("normal").setFontColor("#242a23").setBackground(null);
  sheet.getRange(2, 1).setNumberFormat("dd/mm/yyyy hh:mm");
  sheet.getRange(2, 2).setNumberFormat("ddd dd/mm/yyyy");
}

/* ------------------------------------------------------------------ */
/* E-mail de confirmation                                             */
/* ------------------------------------------------------------------ */

/**
 * Envoie la confirmation au client, avec une copie pour Marie-Tiyi.
 * Jamais d’erreur renvoyée : la réservation est déjà enregistrée à ce stade.
 */
function sendConfirmationEmail_(booking) {
  try {
    const to = contactEmail_();
    const content = buildConfirmationEmail_(booking);
    MailApp.sendEmail(`${quoteName_(booking.name)} <${booking.email}>`, content.subject, content.text, {
      name: CONTACT_NAME,
      replyTo: to,
      cc: to,
      htmlBody: content.html,
    });
  } catch (error) {
    console.error("E-mail de confirmation non envoyé pour " + booking.reference + " : " + error);
  }
}

/** Adresse d’envoi et de réponse, modifiable dans les propriétés du script. */
function contactEmail_() {
  return props_().getProperty("CONTACT_EMAIL") || CONTACT_EMAIL;
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
  const greeting = firstName_(booking.name) ? `Bonjour ${firstName_(booking.name)},` : "Bonjour,";
  const lines = [greeting, "", "Merci pour votre réservation ! Voici le récapitulatif :", ""]
    .concat(recap)
    .concat([
      "",
      meetingLine_(booking.sheet),
      "",
      "Pour annuler ou modifier, répondez simplement à cet e-mail en rappelant votre référence.",
      "",
      closing,
      "",
      "Marie-Tiyi",
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
      `<p style="margin:0 0 1em">${escapeHtml_(closing)}</p>`,
      '<p style="margin:0">Marie-Tiyi<br>',
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
function meetingLine_(sheet) {
  let meeting = "";
  try {
    meeting = cleanText_(sheet.getRange(MEETING_CELL).getValue(), 300);
  } catch (error) {
    meeting = "";
  }
  return meeting ? `Lieu de rendez-vous : ${meeting}` : MEETING_FALLBACK;
}

/** Prénom utilisé dans le corps du message (« Camille Martin » → « Camille »). */
function firstName_(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first.length >= 2 ? first : "";
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
/* Compteurs (places réservées par date)                              */
/* ------------------------------------------------------------------ */

function readVisitRows_(sheet) {
  const last = sheet.getLastRow();
  if (last < VISIT_FIRST_ROW) return [];
  return sheet.getRange(VISIT_FIRST_ROW, 1, last - VISIT_FIRST_ROW + 1, VISIT_HEADERS.length).getValues()
    .filter((row) => row.some((cell) => String(cell).trim() !== ""));
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

function parseIsoDate_(iso) {
  const parts = String(iso).split("-").map(Number);
  return { year: parts[0], month: parts[1], day: parts[2] };
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
  return groups;
}
