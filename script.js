// Réservations publiques : API locale Python (/api) ou Web App Apps Script si BOOKING_API_URL est renseigné.
// les demandes sur mesure utilisent toujours le courriel.
const CONTACT_EMAIL = "balades.culturelles@gmail.com";
const PUBLIC_TOPIC = "Je souhaite réserver une balade publique";
const SENIOR_TOPIC = "Je souhaite réserver une place en balade seniors";
const FAMILY_TOPIC = "Je souhaite réserver une place en balade familles";
const MAX_CAPACITY = 25;
// Groupes de seniors et visites en famille : 20 personnes au maximum.
const GROUP_CAPACITY = 20;
// Places par séance : 25 pour les week-ends tout public, 20 pour les seniors et les familles.
const KIND_CAPACITY = Object.freeze({ public: MAX_CAPACITY, seniors: GROUP_CAPACITY, familles: GROUP_CAPACITY });
// Les trois programmes (week-ends, jeudis, familles) se réservent de la même façon.
const PROGRAMME_TOPICS = Object.freeze([PUBLIC_TOPIC, SENIOR_TOPIC, FAMILY_TOPIC]);
// Un programme par type de sortie : les dates d’un programme ne se mélangent pas
// avec celles d’un autre, même quand la balade porte le même nom.
const TOPIC_KINDS = Object.freeze({
  [PUBLIC_TOPIC]: "public",
  [SENIOR_TOPIC]: "seniors",
  [FAMILY_TOPIC]: "familles",
});
const CUSTOM_CAPACITY = 100;
const SMALL_GROUP_TOPICS = Object.freeze([
  "Je souhaite organiser une visite pour un groupe de seniors",
  "Je souhaite organiser une sortie pour une famille",
]);
// URL de la Web App Apps Script (…/exec), pour la version GitHub Pages. Laisser vide avec le serveur Python local.
const BOOKING_API_URL = "https://script.google.com/macros/s/AKfycbzo7ZZCjaeM2cOuqeLq08qfhwOBwKuCn2zWvHCXamJhlxy67ZM1or_glOYAkx32BKe4hA/exec";
// Le site publié interroge la Web App Google. Partout ailleurs (aperçu Arena, serveur
// local, fichier ouvert dans un navigateur), l’API du serveur Python voisin est
// essayée d’abord — elle sert le programme complet, seniors et familles compris —
// puis la Web App prend le relais si elle n’est pas joignable.
const PUBLISHED_HOSTS = Object.freeze(["baladesculturelles.github.io"]);
const IS_PUBLISHED_SITE = PUBLISHED_HOSTS.includes(window.location.hostname);
const API_BASES = IS_PUBLISHED_SITE ? [BOOKING_API_URL] : ["", BOOKING_API_URL];
let activeApiBase = API_BASES[0];
const AGE_GROUP_PRICES = Object.freeze({ standard: 15, youth: 10, child: 8, underFive: 0 });

const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#primary-navigation");
const contactForm = document.querySelector("#contact-form");
const formStatus = document.querySelector("#form-status");
const dateInput = document.querySelector("#date");
const topicSelect = document.querySelector("#topic");
const slotSelect = document.querySelector("#slot");
const messageInput = document.querySelector("#message");
const sessionSelect = document.querySelector("#session");
const publicSessionField = document.querySelector("#public-session-field");
const customBookingFields = document.querySelector("#custom-booking-fields");
const sessionStatus = document.querySelector("#session-status");
const participantsInput = document.querySelector("#participants");
const customParticipantsInput = document.querySelector("#custom-participants");
const customCapacityNote = document.querySelector("#custom-capacity-note");
const ageGroupsFieldset = document.querySelector("#age-groups");
const ageGroupInputs = [...document.querySelectorAll("[data-age-group]")];
const participantsTotalOutput = document.querySelector("#participants-total");
const bookingEstimateOutput = document.querySelector("#booking-estimate");
const ageGroupStatus = document.querySelector("#age-group-status");
const submitButton = document.querySelector("#submit-booking");

// Chaque balade a son lien : quand la fenêtre s'ouvre depuis ce lien, l'offre et
// la balade sont figées. Le visiteur garde seulement le nombre de personnes et
// ses coordonnées. Pour une autre balade, il revient au programme.
const bookingLock = { interest: "", walk: "", date: "", slot: "" };
let lockedTopicInput = null;
const bookingLockNote = (() => {
  if (!publicSessionField) return null;
  const note = document.createElement("p");
  note.className = "booking-lock-note";
  note.id = "booking-lock-note";
  note.setAttribute("role", "status");
  note.hidden = true;
  publicSessionField.after(note);
  sessionSelect?.setAttribute("aria-describedby", "booking-lock-note");
  return note;
})();

if (contactForm && topicSelect) {
  // Un <select> désactivé n'est pas envoyé : ce champ caché transmet le choix figé.
  lockedTopicInput = document.createElement("input");
  lockedTopicInput.type = "hidden";
  lockedTopicInput.name = "topic";
  lockedTopicInput.disabled = true;
  contactForm.append(lockedTopicInput);
}

/** Fige (ou libère) l'offre et la balade selon le lien d'origine. */
function setBookingLock(target = {}) {
  const interest = target.interest || "";
  const publicBooking = PROGRAMME_TOPICS.includes(interest);
  bookingLock.interest = interest;
  bookingLock.walk = publicBooking ? target.walk || "" : "";
  bookingLock.date = publicBooking ? target.date || "" : "";
  bookingLock.slot = publicBooking ? target.slot || "" : "";
  // Les options de date sont reconstruites pour ne garder que la balade choisie.
  if (availabilityLoaded && sessionSelect) renderSessionOptions();
  syncBookingLockUi();
}

/** Applique le verrouillage à l'interface de la fenêtre de réservation. */
function syncBookingLockUi() {
  if (topicSelect) topicSelect.disabled = Boolean(bookingLock.interest);
  if (lockedTopicInput) {
    lockedTopicInput.disabled = !bookingLock.interest;
    lockedTopicInput.value = topicSelect?.value || "";
  }
  publicSessionField?.classList.toggle("is-locked", Boolean(bookingLock.walk));
  if (sessionSelect) {
    if (!isPublicBooking()) {
      // Cette fenêtre ne réserve pas une place : aucune date ne doit rester sélectionnée.
      sessionSelect.value = "";
      sessionSelect.disabled = true;
    } else if (!bookingLock.walk) {
      sessionSelect.disabled = !isPublicBooking() || !availabilityLoaded;
    } else {
      const match = findSessionForTarget({ walk: bookingLock.walk, date: bookingLock.date, slot: bookingLock.slot });
      if (match) {
        sessionSelect.value = match.id;
        // Une date précise reste figée ; une balade sans date laisse choisir le jour.
        sessionSelect.disabled = Boolean(bookingLock.date) || !availabilityLoaded;
      } else {
        sessionSelect.disabled = !availabilityLoaded;
      }
    }
  }
  if (bookingLockNote) {
    const verrouille = Boolean(bookingLock.interest);
    bookingLockNote.hidden = !verrouille;
    if (verrouille) {
      if (bookingLock.walk && bookingLock.date) {
        bookingLockNote.textContent = `Balade et date choisies depuis le programme : ${bookingLock.walk}, ${formatFrenchDate(bookingLock.date)}. Pour une autre balade, revenez au programme.`;
      } else if (bookingLock.walk) {
        bookingLockNote.textContent = `Balade choisie depuis le programme : ${bookingLock.walk}. Choisissez la date qui vous convient ; pour une autre balade, revenez au programme.`;
      } else {
        bookingLockNote.textContent = "Le type de sortie est choisi depuis le programme. Pour en changer, revenez au programme des balades.";
      }
    }
  }
}
const firstNameInput = document.querySelector("#first-name");
const lastNameInput = document.querySelector("#last-name");
const phoneInput = document.querySelector("#phone");
const walkDialog = document.querySelector("#walk-dialog");
const walkDialogTitle = document.querySelector("#walk-dialog-title");
const walkDialogKicker = document.querySelector("#walk-dialog-kicker");
const walkDialogContent = document.querySelector("#walk-dialog-content");
const walkDialogFoot = document.querySelector("#walk-dialog-foot");
const walkDialogDates = document.querySelector("#walk-dialog-dates");
const walkArticles = walkDialog ? [...walkDialog.querySelectorAll("[data-walk-article]")] : [];
const walkFallbackArticle = walkDialog?.querySelector("[data-walk-fallback]");
const walkFallbackText = walkDialog?.querySelector("[data-walk-fallback-text]");

let availabilityLoaded = false;
let availabilityRequest = null;
let availabilitySessions = [];
const sessionsById = new Map();
let pendingSessionTarget = null;
let availabilityError = false;
let ageGroupsTouched = false;
let bookingIdempotencyKey = "";
let bookingIdempotencyFingerprint = "";

if (header) {
  const updateHeader = () => header.classList.toggle("is-scrolled", window.scrollY > 12);
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });
}

function closeMenu() {
  if (!menuToggle || !navigation) return;
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Ouvrir le menu");
  navigation.classList.remove("is-open");
}

if (menuToggle && navigation) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    menuToggle.setAttribute("aria-label", isOpen ? "Ouvrir le menu" : "Fermer le menu");
    navigation.classList.toggle("is-open", !isOpen);
  });

  navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

// ------------------------------------------------------------------ Onglet actif
// Chaque page du site a son onglet. Sur une page à sections (balades), le menu
// suit en plus la rubrique en cours de lecture, sans modifier le défilement.
const currentFileName = (() => {
  const file = window.location.pathname.split("/").pop();
  return !file || file === "/" ? "index.html" : file;
})();
const navLinks = navigation ? [...navigation.querySelectorAll("a[href]")] : [];
const navTargets = navLinks.map((link) => {
  let url;
  try {
    url = new URL(link.getAttribute("href"), window.location.href);
  } catch (error) {
    url = null;
  }
  const file = url ? (url.pathname.split("/").pop() || "index.html") : "";
  const anchor = url ? url.hash.slice(1) : "";
  const section = anchor && file === currentFileName ? document.getElementById(anchor) : null;
  return { link, file, anchor, section, samePage: file === currentFileName };
});

function setCurrentNav(targetLink) {
  navTargets.forEach(({ link }) => {
    const actif = Boolean(targetLink) && link === targetLink;
    link.classList.toggle("is-current", actif);
    if (actif) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  navigation?.querySelectorAll(".nav-item-dropdown").forEach((item) => {
    const toggle = item.querySelector(".nav-dropdown-toggle");
    if (!toggle) return;
    const descendant = Boolean(item.querySelector(".nav-subnav a.is-current"));
    toggle.classList.toggle("is-ancestor", descendant);
    if (descendant && !toggle.classList.contains("is-current")) toggle.setAttribute("aria-current", "true");
    else if (!descendant && !toggle.classList.contains("is-current")) toggle.removeAttribute("aria-current");
  });
}

if (navTargets.length) {
  const pageLinks = navTargets.filter((item) => item.samePage && !item.anchor);
  const sectionLinks = navTargets.filter((item) => item.samePage && item.section);

  const resolveCurrentLink = () => {
    // En haut de page, c'est l'onglet de la page qui est actif.
    if (window.scrollY <= 0) {
      const primary = pageLinks[0] || navTargets.find((item) => item.file === currentFileName && !item.anchor);
      return primary ? primary.link : null;
    }
    if (sectionLinks.length) {
      const offset = (header ? header.offsetHeight : 0) + 32;
      let courant = null;
      sectionLinks.forEach((item) => {
        if (item.section.getBoundingClientRect().top - offset <= 0) courant = item;
      });
      // Sur une page à sections, l'onglet de la page reste actif en haut de page.
      if (!courant) {
        const primary = pageLinks[0] || navTargets.find((item) => item.file === currentFileName && !item.anchor);
        return primary ? primary.link : null;
      }
      return courant.link;
    }
    if (pageLinks.length) return pageLinks[0].link;
    const exact = navTargets.find((item) => item.file === currentFileName);
    return exact ? exact.link : null;
  };

  let navFrame = 0;
  const updateCurrentNav = () => {
    navFrame = 0;
    setCurrentNav(resolveCurrentLink());
  };
  const requestNavUpdate = () => {
    if (!navFrame) navFrame = window.requestAnimationFrame(updateCurrentNav);
  };
  updateCurrentNav();
  window.addEventListener("scroll", requestNavUpdate, { passive: true });
  window.addEventListener("resize", requestNavUpdate);
  navigation.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (link) setCurrentNav(link);
  });
}

// ------------------------------------------------------------------ Fenêtre de réservation
// Le formulaire n'est plus posé dans la page : il s'ouvre par-dessus quand on
// clique sur une visite. Une visite complète n'ouvre rien : elle affiche
// seulement « Indisponible ».
const bookingDialog = document.querySelector("#booking-dialog");
const bookingNotice = document.querySelector("#booking-notice");
let bookingTrigger = null;
let bookingNoticeTimer = 0;

function showBookingNotice(message) {
  if (!bookingNotice) return;
  bookingNotice.textContent = message;
  bookingNotice.hidden = false;
  bookingNotice.classList.add("is-visible");
  window.clearTimeout(bookingNoticeTimer);
  bookingNoticeTimer = window.setTimeout(() => {
    bookingNotice.hidden = true;
    bookingNotice.classList.remove("is-visible");
  }, 4500);
}

function bookingTargetFromLink(link) {
  const card = link?.closest?.("[data-program-card]");
  return {
    interest: link?.dataset?.interest || "",
    walk: link?.dataset?.walk || card?.dataset.walk || "",
    date: link?.dataset?.date || link?.dataset?.programDate || "",
    slot: link?.dataset?.slot || card?.dataset?.slot || "",
  };
}

function bookingIsSoldOut(link) {
  if (!link) return false;
  return link.dataset.soldOut === "true"
    || link.dataset.allSoldOut === "true"
    || link.getAttribute("aria-disabled") === "true";
}

function describeBookingTarget(target) {
  const parts = [];
  if (target.date) {
    try {
      parts.push(formatFrenchDate(target.date));
    } catch (error) {
      parts.push(target.date);
    }
  }
  if (target.slot) parts.push(target.slot);
  const session = target.walk ? findSessionForTarget(target) : null;
  if (session) parts.push(pluralPlaces(session.remaining));
  return parts.join(" · ");
}

function updateBookingDialogHeading(target, interest) {
  const kicker = bookingDialog?.querySelector("[data-booking-kicker]");
  const title = bookingDialog?.querySelector("[data-booking-title]");
  const meta = bookingDialog?.querySelector("[data-booking-meta]");
  const publicBooking = PROGRAMME_TOPICS.includes(interest);
  if (kicker) {
    kicker.textContent = publicBooking
      ? "Réserver une balade"
      : interest === SENIOR_TOPIC ? "Réserver une balade seniors"
      : interest === FAMILY_TOPIC ? "Réserver une balade familles"
      : interest === "J’ai une autre question" ? "Une question" : "Demande sur mesure";
  }
  if (title) {
    title.textContent = target.walk || (publicBooking ? "Choisissez votre balade" : "Parlons de votre balade");
  }
  if (meta) {
    const description = describeBookingTarget(target);
    meta.textContent = description;
    meta.hidden = !description;
  }
}

function openBookingDialog(target = {}, trigger = null) {
  if (!bookingDialog || !contactForm) return;
  if (trigger instanceof HTMLElement) bookingTrigger = trigger;
  showBookingNotice("");
  if (bookingNotice) bookingNotice.hidden = true;
  updateFormStatus("");

  const interest = target.interest || topicSelect?.value || PUBLIC_TOPIC;
  // L'offre et la balade viennent du lien cliqué : elles ne se changent plus ici.
  setBookingLock({ interest, walk: target.walk, date: target.date, slot: target.slot });
  if (!availabilityLoaded && typeof loadAvailability === "function") {
    if (sessionStatus) sessionStatus.textContent = "Chargement des dates disponibles…";
    loadAvailability();
  }
  if (topicSelect) {
    topicSelect.value = interest;
    updateBookingMode();
  }
  if (messageInput && target.walk && (!messageInput.value.trim() || messageInput.dataset.prefilled === "true")) {
    messageInput.value = `Balade souhaitée : ${target.walk}`;
    messageInput.dataset.prefilled = "true";
  }
  if (PROGRAMME_TOPICS.includes(interest)) {
    chooseSession({ walk: target.walk, date: target.date, slot: target.slot });
  } else {
    if (dateInput && target.date) dateInput.value = target.date;
    if (slotSelect) slotSelect.value = target.slot || "À convenir";
  }
  updateBookingDialogHeading(target, interest);

  if (!bookingDialog.open) {
    if (typeof bookingDialog.showModal === "function") bookingDialog.showModal();
    else {
      bookingDialog.classList.add("is-fallback");
      bookingDialog.setAttribute("open", "");
    }
  }
  const dialogBody = bookingDialog.querySelector(".booking-dialog-body");
  if (dialogBody) dialogBody.scrollTop = 0;
  window.setTimeout(() => {
    const nextField = PROGRAMME_TOPICS.includes(interest) && sessionSelect && !sessionSelect.disabled
      ? sessionSelect
      : dateInput && !PROGRAMME_TOPICS.includes(interest) ? dateInput : sessionSelect;
    nextField?.focus({ preventScroll: true });
  }, 30);
}

function closeBookingDialog() {
  if (!bookingDialog?.open) return;
  if (typeof bookingDialog.close === "function") bookingDialog.close();
  else {
    bookingDialog.removeAttribute("open");
    bookingDialog.classList.remove("is-fallback");
  }
}

if (bookingDialog) {
  bookingDialog.querySelector("[data-booking-close]")?.addEventListener("click", closeBookingDialog);
  // Clic sur le fond assombri : on referme, comme les fenêtres juridiques.
  bookingDialog.addEventListener("click", (event) => {
    if (event.target === bookingDialog) closeBookingDialog();
  });
  bookingDialog.addEventListener("close", () => {
    if (bookingTrigger && document.contains(bookingTrigger)) bookingTrigger.focus({ preventScroll: true });
    bookingTrigger = null;
  });
}

// Un seul point d'entrée pour tous les boutons « Réserver » du site.
// Seuls les liens qui portent un motif de demande ([data-interest]) ouvrent la
// fenêtre : le lien « Me contacter » du menu mène bien à la page contact.
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("[data-interest]") : null;
  if (!link) return;
  event.preventDefault();
  closeMenu();
  if (bookingIsSoldOut(link)) {
    showBookingNotice("Indisponible — cette balade est complète. Choisissez une autre date.");
    return;
  }
  openBookingDialog(bookingTargetFromLink(link), link);
});

// Lien direct (ancien signet, partage) : la fenêtre s'ouvre avec la visite choisie.
function openBookingFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const interest = params.get("interest") || "";
  const walk = params.get("walk") || "";
  if (!interest && !walk) return;
  openBookingDialog({
    interest,
    walk,
    date: params.get("date") || "",
    slot: params.get("slot") || "",
  });
}

// Heure de Paris : la règle est la même pour tous, y compris un iPhone réglé sur
// un autre fuseau. Repli sur l’heure de l’appareil si Intl n’est pas disponible.
const PARIS_FORMAT = (() => {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Paris", hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch (error) {
    return null;
  }
})();

function parisParts(moment) {
  if (!PARIS_FORMAT) {
    const date = new Date(moment);
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
  }
  const parts = {};
  PARIS_FORMAT.formatToParts(new Date(moment)).forEach((part) => { parts[part.type] = part.value; });
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

/** Instant (ms) d’une heure murale de Paris. */
function parisMoment(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (!PARIS_FORMAT) return new Date(year, month - 1, day, hour, minute).getTime();
  const offset = (moment) => {
    const parts = parisParts(moment);
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(moment / 60000) * 60000;
  };
  const first = offset(guess);
  const result = guess - first;
  const second = offset(result);
  return second === first ? result : guess - second;
}

// ------------------------------------------------------------------ Ajout au calendrier (après réservation)
// Le fichier .ics est fabriqué dans le navigateur : aucun serveur, aucune donnée
// supplémentaire. Il n'est proposé qu'APRÈS une réservation confirmée.
// Le lieu de rendez-vous n'est pas encore connu : la ligne LOCATION n'est écrite
// que si une location est fournie (attribut `data-location` à venir par balade).

/** Découpe un créneau « 10 h 30–12 h » en heures et minutes. */
function parseSlotRange(slot) {
  const texte = String(slot || "").replace(/\u2013|\u2014/g, "-");
  const lire = (morceau) => {
    const resultat = morceau.trim().match(/^(\d{1,2})\s*(?:h|:)\s*(\d{2})?/i);
    if (!resultat) return null;
    const heure = Number(resultat[1]);
    const minute = Number(resultat[2] || 0);
    if (heure > 23 || minute > 59) return null;
    return { heure, minute };
  };
  const [debut, fin] = texte.split("-");
  const depart = lire(debut || "");
  if (!depart) return null;
  const arrivee = fin ? lire(fin) : null;
  const finParDefaut = {
    heure: Math.min(depart.heure + 1, 23),
    minute: depart.minute === 0 ? 30 : 0,
  };
  return { depart, arrivee: arrivee || finParDefaut };
}

/** Échappe un texte pour un champ iCalendar (RFC 5545). */
function icsEscape(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * Replie les lignes au-delà de 75 OCTETS (RFC 5545, § 3.1).
 * Le comptage se fait en UTF-8 : compter les caractères dépasserait la limite
 * sur les accents (é, è, à pèsent 2 octets) présents partout dans les titres.
 * Aucun caractère n'est coupé en deux, et chaque ligne de continuation commence
 * par un espace, qui compte dans la limite.
 */
function icsFold(ligne) {
  const octets = (texte) => {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(texte).length;
    return unescape(encodeURIComponent(texte)).length;
  };
  if (octets(ligne) <= 75) return ligne;
  const morceaux = [];
  let courant = "";
  let taille = 0;
  let limite = 75;
  for (const caractere of ligne) {
    const poids = octets(caractere);
    if (taille + poids > limite) {
      morceaux.push(courant);
      courant = "";
      taille = 0;
      limite = 74; // un espace de continuation s'ajoute devant
    }
    courant += caractere;
    taille += poids;
  }
  if (courant) morceaux.push(courant);
  return morceaux[0] + morceaux.slice(1).map((suite) => "\r\n " + suite).join("");
}

/** Horodatage UTC « YYYYMMDDTHHMMSSZ » à partir d'une heure murale de Paris. */
function icsStamp(isoDate, heure, minute) {
  const [annee, mois, jour] = String(isoDate).split("-").map(Number);
  const instant = parisMoment(annee, mois, jour, heure, minute);
  return new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Construit le contenu d'un fichier .ics pour une réservation confirmée.
 * @param {{walk: string, date: string, slot: string, reference?: string, participants?: number, location?: string}} reservation
 * @returns {{contenu: string, nomFichier: string}}
 */
function buildCalendarFile(reservation) {
  const walk = reservation.walk || "Balade culturelle";
  const creneau = parseSlotRange(reservation.slot);
  const [annee, mois, jour] = String(reservation.date).split("-").map(Number);
  const lignes = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Balades Culturelles//Reservation//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${icsEscape(reservation.reference || `${reservation.date}-${walk}`)}@baladesculturelles`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
  ];

  let toutLaJournee = false;
  if (creneau) {
    lignes.push(`DTSTART:${icsStamp(reservation.date, creneau.depart.heure, creneau.depart.minute)}`);
    lignes.push(`DTEND:${icsStamp(reservation.date, creneau.arrivee.heure, creneau.arrivee.minute)}`);
  } else {
    toutLaJournee = true;
    const jourSuivant = new Date(Date.UTC(annee, mois - 1, jour + 1)).toISOString().slice(0, 10);
    lignes.push(`DTSTART;VALUE=DATE:${reservation.date.replace(/-/g, "")}`);
    lignes.push(`DTEND;VALUE=DATE:${jourSuivant.replace(/-/g, "")}`);
  }

  lignes.push(`SUMMARY:${icsEscape(`Balade culturelle — ${walk}`)}`);

  const details = ["Votre réservation est confirmée."];
  if (reservation.reference) details.push(`Référence : ${reservation.reference}.`);
  if (reservation.participants) {
    details.push(`${reservation.participants} personne${reservation.participants > 1 ? "s" : ""}.`);
  }
  details.push("Le lieu de rendez-vous vous est communiqué par e-mail avant la balade.");
  lignes.push(`DESCRIPTION:${icsEscape(details.join("\n"))}`);

  if (reservation.location) lignes.push(`LOCATION:${icsEscape(reservation.location)}`);

  lignes.push("STATUS:CONFIRMED", "TRANSP:OPAQUE");
  if (!toutLaJournee) {
    lignes.push(
      "BEGIN:VALARM",
      "TRIGGER:-P1D",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(`Rappel : votre balade « ${walk} » a lieu demain.`)}`,
      "END:VALARM"
    );
  }
  lignes.push("END:VEVENT", "END:VCALENDAR");

  return {
    contenu: lignes.map(icsFold).join("\r\n") + "\r\n",
    nomFichier: `balade-culturelle-${String(reservation.date || "").replace(/[^0-9-]/g, "")}.ics`,
  };
}

const bookingCalendar = document.querySelector("#booking-calendar");
const bookingCalendarText = document.querySelector("[data-calendar-text]");
const bookingCalendarLink = document.querySelector("[data-calendar-download]");

function hideCalendarLink() {
  if (!bookingCalendar) return;
  if (bookingCalendarLink) {
    if (bookingCalendarLink.dataset.objectUrl) URL.revokeObjectURL(bookingCalendarLink.dataset.objectUrl);
    delete bookingCalendarLink.dataset.objectUrl;
    bookingCalendarLink.removeAttribute("href");
  }
  bookingCalendar.hidden = true;
}

/** Propose « Ajouter à mon agenda » une fois la réservation confirmée. */
function showCalendarLink(reservation) {
  if (!bookingCalendar || !bookingCalendarLink) return;
  const { contenu, nomFichier } = buildCalendarFile(reservation);
  const blob = new Blob([contenu], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  if (bookingCalendarLink.dataset.objectUrl) URL.revokeObjectURL(bookingCalendarLink.dataset.objectUrl);
  bookingCalendarLink.dataset.objectUrl = url;
  bookingCalendarLink.href = url;
  bookingCalendarLink.setAttribute("download", nomFichier);
  if (bookingCalendarText) {
    bookingCalendarText.textContent = `${reservation.walk} — ${formatFrenchDate(reservation.date)}, ${reservation.slot}. Le fichier s'ouvre dans votre calendrier ; le lieu de rendez-vous vous sera envoyé par e-mail.`;
  }
  bookingCalendar.hidden = false;
}

// Point d'entrée pour les tests : vérifier le calcul d'heure (été / hiver).
window.baladesCalendar = { parseSlotRange, buildCalendarFile };

const localToday = () => {
  const parts = PARIS_FORMAT ? parisParts(Date.now()) : null;
  if (parts) return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
if (dateInput) dateInput.min = localToday();

// Une date reste affichée 24 h après la fin de la balade, puis disparaît du site.
const VISIBLE_HOURS_AFTER_END = 24;
const SLOT_TIME = /(\d{1,2})\s*(?:h|:)\s*(\d{1,2})?/;

function slotBounds(slot) {
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
  if (end[0] * 60 + end[1] <= start[0] * 60 + start[1]) end = [(start[0] + 1) % 24, start[1]];
  return { start, end };
}

function sessionEndMoment(isoDate, slot) {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  const { end } = slotBounds(slot);
  return parisMoment(year, month, day, end[0], end[1]);
}

function sessionHideMoment(isoDate, slot) {
  const end = sessionEndMoment(isoDate, slot);
  return end === null ? null : end + VISIBLE_HOURS_AFTER_END * 3_600_000;
}

function sessionIsHidden(isoDate, slot, now = Date.now()) {
  const moment = sessionHideMoment(isoDate, slot);
  return moment !== null && now >= moment;
}

document.querySelectorAll("[data-program-date]").forEach((date) => {
  const isoDate = date.dataset.programDate || date.dateTime;
  const slot = date.dataset.slot || date.closest("[data-program-card]")?.dataset.slot || "";
  if (isoDate && sessionIsHidden(isoDate, slot)) date.hidden = true;
});

const programCards = [...document.querySelectorAll("[data-program-card]")];
const programEmpty = document.querySelector("[data-program-empty]");
const programFilterEmpty = document.querySelector("#program-filter-empty");
const programSearchInput = document.querySelector("#program-search");
const programFilterButtons = [...document.querySelectorAll("[data-program-filter]")];
const availableFilterButton = document.querySelector('[data-program-filter="available"]');
const programResultCount = document.querySelector("#program-result-count");
const nextWalkBanner = document.querySelector("#prochaine-balade");
const nextWalkCta = nextWalkBanner?.querySelector("[data-next-walk-cta]");
const bookingRecap = document.querySelector("#booking-recap");
const clearProgramFiltersButton = document.querySelector("#clear-program-filters");
let activeProgramFilter = "all";

// Une balade dont toutes les dates sont passées reste au programme : seules les
// dates disparaissent (24 h après la balade). L’offre de la saison reste à 13 balades.
function refreshProgramCard(card) {
  const upcoming = [...card.querySelectorAll("[data-program-date]:not([hidden])")];
  card.dataset.hasUpcoming = String(upcoming.length > 0);
  // Sans date à venir, la balade reste au programme avec une phrase à la place des dates.
  const container = card.querySelector(".program-dates");
  if (!container) return;
  const note = container.querySelector(".program-no-date");
  if (!upcoming.length && !note) {
    const message = document.createElement("p");
    message.className = "program-no-date";
    message.textContent = "Aucune date programmée pour le moment.";
    container.append(message);
  } else if (upcoming.length && note) {
    note.remove();
  }
}
programCards.forEach(refreshProgramCard);
if (availableFilterButton) availableFilterButton.disabled = true;

// « 13 balades » est l’offre de la saison : le nombre ne baisse pas quand une date passe.
// Seul le nombre de dates à venir évolue, et il disparaît 24 h après chaque balade.
function updateProgramCounts() {
  if (!programCards.length) return;
  const dates = programCards.reduce((total, card) => total + card.querySelectorAll("[data-program-date]:not([hidden])").length, 0);
  const datesOutput = document.querySelector("[data-count-dates]");
  if (datesOutput) datesOutput.textContent = String(dates);
}

// Raccourci vers la date la plus proche encore réservable.
function updateNextWalk() {
  if (!nextWalkBanner) return;
  const now = Date.now();
  const entries = programCards
    .flatMap((card) => [...card.querySelectorAll("[data-program-date]:not([hidden])")]
      .map((lien) => ({ card, lien })))
    // Une date encore affichée 24 h après la balade n’est plus « la prochaine ».
    .filter(({ lien, card }) => {
      const end = sessionEndMoment(lien.dataset.programDate || lien.dateTime, lien.dataset.slot || card.dataset.slot || "");
      return end !== null && end > now;
    })
    .sort((a, b) => (a.lien.dataset.programDate || "").localeCompare(b.lien.dataset.programDate || ""));
  if (!entries.length) {
    nextWalkBanner.hidden = true;
    return;
  }
  const available = entries.find(({ lien }) => lien.dataset.soldOut === "false");
  const choice = available || entries[0];
  const walk = choice.lien.dataset.walk || choice.card.dataset.walk || "";
  const date = choice.lien.dataset.programDate || "";
  const slot = choice.lien.dataset.slot || choice.card.dataset.slot || "";
  const fullDate = choice.lien.dataset.fullDate || date;
  const weekday = choice.lien.querySelector(".program-date-weekday")?.textContent?.trim() || "";
  const places = choice.lien.querySelector("[data-availability-label]")?.textContent?.trim() || "";
  nextWalkBanner.hidden = false;
  nextWalkBanner.classList.toggle("is-complete", !available);
  const title = nextWalkBanner.querySelector("#next-walk-title");
  const dateOutput = nextWalkBanner.querySelector("[data-next-walk-date]");
  const placesOutput = nextWalkBanner.querySelector("[data-next-walk-places]");
  const thumb = nextWalkBanner.querySelector("[data-next-walk-img]");
  if (title) title.textContent = walk;
  if (dateOutput) dateOutput.textContent = `${weekday} ${fullDate}`.trim();
  if (placesOutput) placesOutput.textContent = available ? places : "complet";
  if (thumb && choice.card.dataset.image) {
    thumb.src = choice.card.dataset.image;
    thumb.alt = choice.card.dataset.imageAlt || walk;
  }
  if (nextWalkCta) {
    nextWalkCta.dataset.walk = walk;
    nextWalkCta.dataset.date = date;
    nextWalkCta.dataset.slot = slot;
    nextWalkCta.dataset.interest = PUBLIC_TOPIC;
    const details = nextWalkCta.querySelector("[data-next-walk-details]");
    if (details) details.textContent = ` : ${walk}, ${fullDate}`;
    nextWalkCta.removeAttribute("aria-label");
  }
}
updateProgramCounts();
updateNextWalk();

// ------------------------------------------------------------------ Les prochaines balades, en carrousel
const inspirationTrack = document.querySelector("#inspiration-track");
const inspirationPrevButton = document.querySelector("[data-inspiration-prev]");
const inspirationNextButton = document.querySelector("[data-inspiration-next]");
const seniorsTrack = document.querySelector("#seniors-track");
const seniorsPrevButton = document.querySelector("[data-seniors-prev]");
const seniorsNextButton = document.querySelector("[data-seniors-next]");
const famillesTrack = document.querySelector("#familles-track");
const famillesPrevButton = document.querySelector("[data-familles-prev]");
const famillesNextButton = document.querySelector("[data-familles-next]");
const inspirationCards = [];

// Dimensions intrinsèques des photos du programme. Les attributs width/height
// réservent la place avant le chargement (anti-CLS) sans imposer la hauteur :
// le CSS et son aspect-ratio restent maîtres du cadrage.
const WALK_IMAGE_SIZES = Object.freeze({
  "walk-bridges": [1376, 768],
  "walk-grands-magasins": [800, 907],
  "walk-haussmann": [800, 500],
  "walk-inde-paris": [800, 500],
  "walk-la-defense": [800, 500],
  "walk-moliere": [800, 854],
  "walk-montparnasse": [800, 500],
  "walk-montsouris": [800, 500],
  "walk-nation-art-nouveau": [800, 500],
  "walk-passages-couverts": [1080, 1080],
  "walk-pere-lachaise": [800, 500],
  "walk-philippe-auguste": [800, 500],
  "walk-quartier-chinois": [800, 500],
  "walk-tour-eiffel": [800, 500],
});

/** « 2027-01-28 » → { jour: "28", semaine: "jeu.", mois: "janv." } */
function shortDateParts(isoDate) {
  const moment = new Date(`${isoDate}T12:00:00Z`);
  const format = (options) => new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }).format(moment);
  return {
    jour: format({ day: "numeric" }),
    semaine: format({ weekday: "short" }),
    mois: format({ month: "short" }),
  };
}

/** Toutes les dates s'annoncent de la même façon : « 28 JANV. · 25 places ». */
function dateChipHtml(isoDate) {
  const { jour, semaine, mois } = shortDateParts(isoDate);
  return `<span class="next-card-date-chip"><b>${escapeHtml(jour)}</b> ${escapeHtml(semaine)} ${escapeHtml(mois)}</span>`;
}

/** « 10 h 30–12 h » → « 10 h 30 – 12 h » : lisible et respiré. */
function formatSlot(slot) {
  return String(slot || "").replace(/\s*[–-]\s*/g, " – ").trim();
}

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function formatWalkPeriod(liensDates) {
  if (!liensDates.length) return "";
  const lire = (lien) => ({
    jour: lien.querySelector(".program-date-day")?.textContent?.trim() || "",
    mois: lien.querySelector(".program-date-month")?.textContent?.trim() || "",
    annee: (lien.dataset.programDate || "").slice(0, 4),
  });
  const premier = lire(liensDates[0]);
  if (liensDates.length === 1) return `${premier.jour} ${premier.mois} ${premier.annee}`.trim();
  const dernier = lire(liensDates[liensDates.length - 1]);
  if (premier.mois === dernier.mois && premier.annee === dernier.annee) {
    return `${premier.jour} & ${dernier.jour} ${premier.mois} ${premier.annee}`.trim();
  }
  return `${premier.jour} ${premier.mois} & ${dernier.jour} ${dernier.mois} ${dernier.annee}`.trim();
}

function populateCardsToTrack(track, prevBtn, nextBtn, baladesList, defaultInterest) {
  if (!track) return;
  track.replaceChildren();

  baladesList.forEach(({ card, liensDates }, index) => {
    const walk = card.dataset.walk || "";
    const slot = card.dataset.slot || "";
    const image = card.dataset.image || "";
    const imageAlt = card.dataset.imageAlt || walk;
    const imageStem = image.split("/").pop().replace(/\.jpg$/i, "");
    const imageSize = WALK_IMAGE_SIZES[imageStem] || [800, 500];
    const imageWebp = imageStem
      ? `<source type="image/webp" sizes="(max-width: 560px) 86vw, (max-width: 980px) 45vw, 380px" srcset="assets/responsive/${escapeHtml(imageStem)}-400.webp 400w, assets/responsive/${escapeHtml(imageStem)}-480.webp 480w, assets/responsive/${escapeHtml(imageStem)}-800.webp 800w">`
      : "";
    const summary = card.dataset.summary || "";
    const kind = card.querySelector(".program-kind")?.textContent?.trim() || "";
    const numero = String(index + 1).padStart(2, "0");
    const periode = formatWalkPeriod(liensDates);

    const carte = document.createElement("li");
    carte.className = "next-card";
    carte.dataset.walk = walk;

    const datesHtml = liensDates.map((lien, idx) => {
      const date = lien.dataset.programDate || "";
      const dateComplete = lien.dataset.fullDate || date;
      const jour = lien.querySelector(".program-date-day")?.textContent?.trim() || "";
      const weekday = lien.querySelector(".program-date-weekday")?.textContent?.trim() || "";
      const mois = lien.querySelector(".program-date-month")?.textContent?.trim() || "";
      return `
        <a class="next-card-date-pill" href="#contact" data-next-date-index="${idx}" data-interest="${escapeHtml(defaultInterest || PUBLIC_TOPIC)}" data-walk="${escapeHtml(walk)}" data-date="${escapeHtml(date)}" data-slot="${escapeHtml(slot)}">
          <span class="next-card-date-chip"><b>${escapeHtml(jour)}</b> ${escapeHtml(weekday)} ${escapeHtml(mois)}</span>
          <span class="next-card-places" data-next-places>Chargement…</span>
          <span class="visually-hidden" data-next-details>${escapeHtml(walk)} — ${escapeHtml(dateComplete)}</span>
        </a>`;
    }).join("");

    carte.innerHTML = `
      <div class="next-card-media">
        <picture>${imageWebp}<img class="next-card-image" src="${escapeHtml(image)}" width="${imageSize[0]}" height="${imageSize[1]}" alt="${escapeHtml(imageAlt)}" loading="lazy" decoding="async"></picture>
        <span class="next-card-badge">${escapeHtml(numero)}</span>
        <span class="next-card-period">${escapeHtml(periode)}</span>
      </div>
      <div class="next-card-body">
        <span class="next-card-kind">${escapeHtml(kind)}</span>
        <h3 class="next-card-title"><button type="button" class="next-card-title-link" data-walk-open="${escapeHtml(walk)}">${escapeHtml(walk)}</button></h3>
        <p class="next-card-summary">${escapeHtml(summary)}</p>
        <p class="next-card-time"><span class="next-card-time-label">Horaires</span> <strong>${escapeHtml(formatSlot(slot))}</strong></p>
        <div class="next-card-dates" aria-label="Prochaines dates pour ${escapeHtml(walk)}">${datesHtml}</div>
      </div>`;

    const pilules = [...carte.querySelectorAll(".next-card-date-pill")];
    const couplesDates = liensDates.map((lien, idx) => ({ lien, pilule: pilules[idx] }));
    track.append(carte);
    inspirationCards.push({ carte, couplesDates });
  });

  setupInspirationCarousel(track, prevBtn, nextBtn);
}

// Câblage commun des carrousels : flèches, pas de défilement et état des boutons.
function setupInspirationCarousel(track, prevBtn, nextBtn) {
  const updateButtons = () => {
    const max = track.scrollWidth - track.clientWidth - 2;
    if (prevBtn) prevBtn.disabled = track.scrollLeft <= 2;
    if (nextBtn) nextBtn.disabled = track.scrollLeft >= max;
  };
  const scroll = (dir) => {
    const carte = track.querySelector(".next-card");
    if (!carte) return;
    const ecart = parseFloat(window.getComputedStyle(track).columnGap || "13") || 13;
    const pas = carte.getBoundingClientRect().width + ecart;
    track.scrollBy({ left: dir * pas, behavior: "smooth" });
  };

  if (prevBtn && !prevBtn._hasCarouselHandler) {
    prevBtn._hasCarouselHandler = true;
    prevBtn.addEventListener("click", () => scroll(-1));
  }
  if (nextBtn && !nextBtn._hasCarouselHandler) {
    nextBtn._hasCarouselHandler = true;
    nextBtn.addEventListener("click", () => scroll(1));
  }
  track.addEventListener("scroll", updateButtons, { passive: true });
  window.addEventListener("resize", updateButtons);
  updateButtons();
}

// Programme des balades seniors : certains jeudis de la saison 2026-2027.
const SENIOR_SLOT = "10 h 30–11 h 45";
const SENIOR_SESSIONS = Object.freeze([
  { date: "2026-09-24", walk: "Le cimetière du Montparnasse" },
  { date: "2026-10-15", walk: "Sur les pas d’Hector Guimard" },
  { date: "2026-11-26", walk: "Le Paris de Molière" },
  { date: "2027-01-28", walk: "Les passages couverts" },
  { date: "2027-02-25", walk: "Le quartier et l’église Saint-Séverin" },
  { date: "2027-03-18", walk: "Le parc Monceau et ses hôtels particuliers" },
  { date: "2027-04-29", walk: "La butte aux Cailles" },
  { date: "2027-05-27", walk: "Le quartier de la Nouvelle Athènes" },
  { date: "2027-06-24", walk: "La muraille de Philippe Auguste" },
]);

// Programme des balades familles : certains mercredis de la saison 2026-2027.
const FAMILY_SLOT = "10 h 30–11 h 45";
const FAMILY_SESSIONS = Object.freeze([
  { walk: "Le square du Maréchal Leclerc", dates: ["2026-09-23", "2027-01-06", "2027-03-24", "2027-06-09"] },
  { walk: "Le parc de Voyer d’Argenson", dates: ["2026-09-30", "2027-01-13", "2027-03-31", "2027-06-16"] },
  { walk: "Le square du Maréchal Joffre", dates: ["2026-10-07", "2027-01-20", "2027-04-21", "2027-06-23"] },
  { walk: "Le square Sylvain", dates: ["2026-10-14", "2027-01-27", "2027-04-28", "2027-06-30"] },
  { walk: "Le square Maréchal de Lattre de Tassigny", dates: ["2026-11-04", "2027-02-03", "2027-05-05"] },
  { walk: "Le parc Robinson", dates: ["2026-11-18", "2027-02-24", "2027-05-12"] },
  { walk: "La mairie d’Asnières", dates: ["2026-11-24", "2027-03-03", "2027-05-19"] },
  { walk: "Le cimetière ancien, un lieu de mémoire", dates: ["2026-12-02", "2027-03-10", "2027-05-26"] },
  { walk: "Le cimetière des chiens, un lieu pour nos amis les bêtes", dates: ["2026-12-09", "2027-03-17", "2027-06-02"] },
]);

/** Balades familles avec leurs dates encore à venir. */
function upcomingFamilySessions(now = Date.now()) {
  return FAMILY_SESSIONS
    .map(({ walk, dates }) => ({
      walk,
      dates: dates.filter((date) => !sessionIsHidden(date, FAMILY_SLOT, now)).sort(),
    }))
    .filter((entree) => entree.dates.length > 0);
}

// Carrousel dédié Familles : une carte par balade, avec ses dates à venir.
function populateFamilyCards(track, prevBtn, nextBtn) {
  if (!track) return;
  track.replaceChildren();
  const balades = upcomingFamilySessions();
  if (!balades.length) {
    const vide = document.createElement("li");
    vide.className = "next-card family-card";
    vide.innerHTML = '<div class="next-card-body"><p class="next-card-summary">Le programme de la saison prochaine sera annoncé ici.</p></div>';
    track.append(vide);
  }
  balades.forEach(({ walk, dates }) => {
    const pills = dates.map((date) => {
      return `
        <a class="next-card-date-pill" href="contact.html" data-interest="${escapeHtml(FAMILY_TOPIC)}" data-walk="${escapeHtml(walk)}" data-date="${escapeHtml(date)}" data-slot="${escapeHtml(FAMILY_SLOT)}" aria-label="Réserver la balade familles du ${escapeHtml(formatFrenchDate(date))}">
          ${dateChipHtml(date)}
          <span class="next-card-places" data-offer-places>${capacityForKind("familles")} places</span>
        </a>`;
    }).join("");
    const li = document.createElement("li");
    li.className = "next-card family-card";
    li.innerHTML = `
      <div class="next-card-body">
        <span class="next-card-kind">Balade familles · 1 h 15</span>
        <h3 class="next-card-title">${escapeHtml(walk)}</h3>
        <p class="next-card-summary">Une balade contée et interactive, avec des énigmes pour petits et grands.</p>
        <p class="next-card-time"><span class="next-card-time-label">Horaires</span> <strong>${escapeHtml(formatSlot(FAMILY_SLOT))}</strong></p>
        <div class="next-card-dates" aria-label="Dates des balades familles">${pills}</div>
      </div>`;
    track.append(li);
  });
  setupInspirationCarousel(track, prevBtn, nextBtn);
  syncOfferPlaces();
}

// Certaines balades seniors sont les mêmes que celles du week-end : on réutilise
// alors leur photo, leur thème et leur résumé pour des cartes identiques.
const SENIOR_WALK_ALIASES = Object.freeze({
  "La muraille de Philippe Auguste": "Sur les traces de l’enceinte de Philippe Auguste",
});

function publicWalkInfos(walk) {
  const cible = SENIOR_WALK_ALIASES[walk] || walk;
  const carte = programCards.find((item) => (item.dataset.walk || "") === cible);
  if (!carte) return null;
  return {
    walk: carte.dataset.walk || cible,
    image: carte.dataset.image || "",
    imageAlt: carte.dataset.imageAlt || cible,
    summary: carte.dataset.summary || "",
    kind: carte.querySelector(".program-kind")?.textContent?.trim() || "",
  };
}

/** Photo d’une balade, avec sa variante WebP, comme dans le carrousel tout public. */
function walkMediaHtml(image, imageAlt, badge, periode) {
  const imageStem = image.split("/").pop().replace(/\.jpg$/i, "");
  const [width, height] = WALK_IMAGE_SIZES[imageStem] || [800, 500];
  const imageWebp = imageStem
    ? `<source type="image/webp" sizes="(max-width: 560px) 86vw, (max-width: 980px) 45vw, 380px" srcset="assets/responsive/${escapeHtml(imageStem)}-400.webp 400w, assets/responsive/${escapeHtml(imageStem)}-480.webp 480w, assets/responsive/${escapeHtml(imageStem)}-800.webp 800w">`
    : "";
  return `
      <div class="next-card-media">
        <picture>${imageWebp}<img class="next-card-image" src="${escapeHtml(image)}" width="${width}" height="${height}" alt="${escapeHtml(imageAlt)}" loading="lazy" decoding="async"></picture>
        <span class="next-card-badge">${escapeHtml(badge)}</span>
        <span class="next-card-period">${escapeHtml(periode)}</span>
      </div>`;
}

/** Séances seniors encore à venir, dans l’ordre chronologique. */
function upcomingSeniorSessions(now = Date.now()) {
  return SENIOR_SESSIONS
    .filter((session) => !sessionIsHidden(session.date, SENIOR_SLOT, now))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Carrousel dédié Seniors : une carte par date encore à venir.
function populateSeniorCards(track, prevBtn, nextBtn) {
  if (!track) return;
  track.replaceChildren();
  const sessions = upcomingSeniorSessions();
  if (!sessions.length) {
    const vide = document.createElement("li");
    vide.className = "next-card senior-card";
    vide.innerHTML = '<div class="next-card-body"><p class="next-card-summary">Le programme de la saison prochaine sera annoncé ici.</p></div>';
    track.append(vide);
  }
  sessions.forEach((session, index) => {
    const date = new Date(`${session.date}T12:00:00Z`);
    const periode = new Intl.DateTimeFormat("fr-FR", {
      day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
    }).format(date);
    const infos = publicWalkInfos(session.walk);
    const numero = String(index + 1).padStart(2, "0");
    const mediaHtml = infos?.image ? walkMediaHtml(infos.image, infos.imageAlt, numero, periode) : "";
    const kind = infos?.kind || "Balade seniors · 1 h 15";
    const resume = infos?.summary || "Au rythme paisible, avec des étapes de repos.";
    const li = document.createElement("li");
    li.className = "next-card senior-card";
    li.dataset.seniorDate = session.date;
    if (infos) li.dataset.walk = session.walk;
    li.innerHTML = `${mediaHtml}
      <div class="next-card-body">
        <span class="next-card-kind">${escapeHtml(kind)}</span>
        <h3 class="next-card-title">${escapeHtml(session.walk)}</h3>
        <p class="next-card-summary">${escapeHtml(resume)}</p>
        <p class="next-card-time"><span class="next-card-time-label">Horaires</span> <strong>${escapeHtml(formatSlot(SENIOR_SLOT))}</strong></p>
        <div class="next-card-dates" aria-label="Date de la balade seniors">
          <a class="next-card-date-pill" href="contact.html" data-interest="${escapeHtml(SENIOR_TOPIC)}" data-walk="${escapeHtml(session.walk)}" data-date="${escapeHtml(session.date)}" data-slot="${escapeHtml(SENIOR_SLOT)}" aria-label="Réserver la balade seniors du ${escapeHtml(formatFrenchDate(session.date))}">
            ${dateChipHtml(session.date)}
            <span class="next-card-places" data-offer-places>${capacityForKind("seniors")} places</span>
          </a>
        </div>
      </div>`;
    track.append(li);
  });
  setupInspirationCarousel(track, prevBtn, nextBtn);
  syncOfferPlaces();
}

// Une carte par balade à venir, dans l’ordre chronologique, avec sa photo et son résumé.
function buildInspirationTrack() {
  inspirationCards.length = 0;

  const baladesAVenir = programCards
    .map((card) => {
      const liensDates = [...card.querySelectorAll("[data-program-date]")]
        .filter((lien) => !lien.hidden)
        .sort((a, b) => (a.dataset.programDate || "").localeCompare(b.dataset.programDate || ""));
      return {
        card,
        liensDates,
        premiereDate: liensDates[0]?.dataset.programDate || "",
      };
    })
    .filter((entree) => entree.liensDates.length > 0)
    .sort((a, b) => a.premiereDate.localeCompare(b.premiereDate));

  // 1. Carrousel principal Tout public (week-ends)
  if (inspirationTrack) {
    populateCardsToTrack(inspirationTrack, inspirationPrevButton, inspirationNextButton, baladesAVenir, PUBLIC_TOPIC);
  }

  // 2. Carrousel dédié Seniors : les dates de la saison encore à venir.
  if (seniorsTrack) {
    populateSeniorCards(seniorsTrack, seniorsPrevButton, seniorsNextButton);
  }

  // 3. Carrousel dédié Familles : les dates de la saison encore à venir.
  if (famillesTrack) {
    populateFamilyCards(famillesTrack, famillesPrevButton, famillesNextButton);
  }

  syncInspirationTrack();
}

// Génère des cartes d’emplacement vides pour les catégories en cours de création
function populatePlaceholderCards(track, prevBtn, nextBtn, categoryLabel, count = 4, duree = "1 h 15") {
  if (!track) return;
  track.replaceChildren();

  for (let i = 1; i <= count; i++) {
    const num = String(i).padStart(2, "0");
    const li = document.createElement("li");
    li.className = "next-card placeholder-card";
    li.setAttribute("aria-label", `Emplacement ${num} · Balade ${categoryLabel} en cours de création`);
    li.innerHTML = `
      <div class="placeholder-card-media">
        <div class="placeholder-media-inner">
          <span class="placeholder-card-number">${num}</span>
          <span class="placeholder-card-badge">En cours de création</span>
        </div>
      </div>
      <div class="next-card-body placeholder-card-body">
        <p class="next-card-kind">En cours de création</p>
        <h3 class="next-card-title">Case libre · ${escapeHtml(categoryLabel)}</h3>
        <p class="next-card-summary">Le parcours, le thème et les créneaux pour les ${escapeHtml(categoryLabel.toLowerCase())} sont en cours de création par Marie-Tiyi.</p>
        <div class="next-card-dates placeholder-dates">
          <span class="placeholder-pill"><span aria-hidden="true">📅</span> Date à définir</span>
          <span class="placeholder-pill"><span aria-hidden="true">🕒</span> Durée : ${escapeHtml(duree)}</span>
        </div>
      </div>
    `;
    track.appendChild(li);
  }

  setupInspirationCarousel(track, prevBtn, nextBtn);
}

// Les places restantes suivent celles du programme.
// Places affichées sur les dates seniors et familles : les disponibilités quand
// la séance est ouverte à la réservation, sinon la capacité du programme
// (25 places tout public, 20 pour les seniors et les familles).
function syncOfferPlaces() {
  document.querySelectorAll("[data-offer-places]").forEach((cible) => {
    const pillule = cible.closest("[data-date]");
    const date = pillule?.dataset.date || "";
    const walk = pillule?.dataset.walk || "";
    const slot = pillule?.dataset.slot || "";
    const session = availabilitySessions.find(
      (item) => item.date === date && item.walk === walk && (!slot || item.slot === slot),
    );
    if (session) {
      cible.textContent = session.remaining > 0
        ? `${session.remaining} place${session.remaining > 1 ? "s" : ""}`
        : "Indisponible";
      cible.dataset.soldOut = session.remaining > 0 ? "" : "true";
    } else {
      const kind = TOPIC_KINDS[pillule?.dataset.interest] || "public";
      cible.textContent = `${capacityForKind(kind)} places`;
      cible.dataset.soldOut = "";
    }
  });
}

function syncInspirationTrack() {
  inspirationCards.forEach(({ carte, couplesDates }) => {
    couplesDates.forEach(({ lien, pilule }) => {
      if (!pilule) return;
      const source = lien.querySelector("[data-availability-label]");
      const cible = pilule.querySelector("[data-next-places]");
      const complet = lien.dataset.soldOut === "true";
      // Une date sans place s'annonce « Indisponible » : le clic n'ouvrira rien.
      if (cible) cible.textContent = complet ? "Indisponible" : source?.textContent || cible.textContent;
      const details = pilule.querySelector("[data-next-details]");
      if (details && source) details.textContent = source.textContent;
      pilule.classList.toggle("is-sold-out", complet);
      pilule.dataset.soldOut = complet ? "true" : "";
      pilule.setAttribute("aria-disabled", String(complet));
    });
    const toutesCompletes = couplesDates.length > 0 && couplesDates.every(({ lien }) => lien.dataset.soldOut === "true");
    carte.classList.toggle("is-sold-out", toutesCompletes);
  });
  if (typeof renderWalkDialogDates === "function" && walkDialog?.open && walkDialog.dataset.currentWalk) {
    renderWalkDialogDates(walkDialog.dataset.currentWalk);
  }
}

buildInspirationTrack();

function bookingKind(topic = bookingLock.interest || topicSelect?.value || "") {
  return TOPIC_KINDS[topic] || "public";
}

function sessionKind(session) {
  return session?.kind || "public";
}

/** Places d’un programme : 25 tout public, 20 seniors et familles. */
function capacityForKind(kind) {
  return KIND_CAPACITY[kind] || MAX_CAPACITY;
}

/** Places d’une séance : celles publiées par l’API, sinon celles de son programme. */
function limitForSession(session) {
  const value = Number(session?.capacity);
  return Number.isInteger(value) && value >= 1 ? value : capacityForKind(sessionKind(session));
}

/** Limite à afficher : la séance choisie, sinon le programme en cours. */
function currentBookingLimit(session = getSelectedSession()) {
  return session ? limitForSession(session) : capacityForKind(bookingKind());
}

function isPublicBooking() {
  return PROGRAMME_TOPICS.includes(topicSelect?.value || "");
}

/** Nombre maximum de personnes pour une demande sur mesure. */
function customCapacityForTopic(topic) {
  return SMALL_GROUP_TOPICS.includes(topic) ? GROUP_CAPACITY : CUSTOM_CAPACITY;
}

function updateBookingMode() {
  const publicMode = isPublicBooking();
  if (publicSessionField) publicSessionField.hidden = !publicMode;
  if (customBookingFields) customBookingFields.hidden = publicMode;
  if (sessionStatus) sessionStatus.hidden = !publicMode;
  if (sessionSelect) {
    sessionSelect.required = publicMode;
    sessionSelect.disabled = publicMode && !availabilityLoaded;
  }
  if (participantsInput) {
    participantsInput.disabled = !publicMode;
    participantsInput.required = false;
    participantsInput.max = String(currentBookingLimit());
  }
  if (ageGroupsFieldset) ageGroupsFieldset.hidden = !publicMode;
  ageGroupInputs.forEach((input) => {
    input.disabled = !publicMode;
    input.max = String(currentBookingLimit());
  });
  const customLimit = customCapacityForTopic(topicSelect?.value || "");
  if (customParticipantsInput) {
    customParticipantsInput.disabled = publicMode;
    customParticipantsInput.max = String(customLimit);
    if (Number(customParticipantsInput.value) > customLimit) customParticipantsInput.value = String(customLimit);
  }
  if (customCapacityNote) {
    customCapacityNote.hidden = publicMode;
    customCapacityNote.textContent = customLimit === GROUP_CAPACITY
      ? "Indiquez le nombre de personnes : 20 personnes maximum pour un groupe de seniors ou une famille."
      : "Indiquez le nombre de personnes estimé pour votre groupe.";
  }
  syncBookingLockUi();
  if (submitButton) {
    const label = publicMode ? "Réserver ma place" : "Envoyer ma demande";
    const arrow = submitButton.querySelector(".arrow");
    submitButton.firstChild.textContent = `${label} `;
    if (arrow) submitButton.append(arrow);
  }
  updateSessionStatus();
}

if (topicSelect) topicSelect.addEventListener("change", () => {
  updateFormStatus("");
  updateBookingMode();
  // Changer de programme change les dates proposées : tout public, seniors ou familles.
  if (availabilityLoaded && isPublicBooking()) renderSessionOptions();
});

function makeSessionId(date, walk, slot) {
  return `${date}|${walk}|${slot}`;
}

function formatFrenchDate(isoDate, includeWeekday = true) {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  const options = { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" };
  if (includeWeekday) options.weekday = "long";
  const label = new Intl.DateTimeFormat("fr-FR", options).format(parsed);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function pluralPlaces(count) {
  return `${count} place${count > 1 ? "s" : ""}`;
}

function readAgeGroups() {
  const ageGroups = { standard: 0, youth: 0, child: 0, underFive: 0 };
  let valid = true;
  ageGroupInputs.forEach((input) => {
    const value = input.value === "" ? 0 : Number(input.value);
    if (!Number.isInteger(value) || value < 0 || value > CUSTOM_CAPACITY) valid = false;
    ageGroups[input.dataset.ageGroup] = value;
  });
  return { ageGroups, valid };
}

function ageGroupTotal(ageGroups) {
  return Object.values(ageGroups).reduce((total, count) => total + count, 0);
}

const BOOKING_IDEMPOTENCY_STORAGE_KEY = "balades-booking-idempotency";

function createBookingIdempotencyKey() {
  if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
  if (typeof window.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function clearBookingIdempotencyKey() {
  bookingIdempotencyKey = "";
  bookingIdempotencyFingerprint = "";
  try {
    window.sessionStorage.removeItem(BOOKING_IDEMPOTENCY_STORAGE_KEY);
  } catch (_) {
    // Le repli en mémoire reste utilisable si le stockage du navigateur est bloqué.
  }
}

function syncBookingIdempotencySelection(sessionId, participants) {
  const fingerprint = JSON.stringify([sessionId || "", participants]);
  if (bookingIdempotencyKey && bookingIdempotencyFingerprint !== fingerprint) {
    clearBookingIdempotencyKey();
  }
}

function getBookingIdempotencyKey(sessionId, participants) {
  const fingerprint = JSON.stringify([sessionId || "", participants]);
  syncBookingIdempotencySelection(sessionId, participants);
  if (bookingIdempotencyKey && bookingIdempotencyFingerprint === fingerprint) return bookingIdempotencyKey;

  try {
    const stored = JSON.parse(window.sessionStorage.getItem(BOOKING_IDEMPOTENCY_STORAGE_KEY) || "null");
    if (stored && stored.fingerprint === fingerprint && typeof stored.key === "string" && stored.key) {
      bookingIdempotencyKey = stored.key;
      bookingIdempotencyFingerprint = fingerprint;
      return bookingIdempotencyKey;
    }
  } catch (_) {
    // Le repli en mémoire évite de bloquer la réservation si sessionStorage échoue.
  }

  bookingIdempotencyKey = createBookingIdempotencyKey();
  bookingIdempotencyFingerprint = fingerprint;
  try {
    window.sessionStorage.setItem(BOOKING_IDEMPOTENCY_STORAGE_KEY, JSON.stringify({ fingerprint, key: bookingIdempotencyKey }));
  } catch (_) {
    // La clé reste conservée en mémoire pour les nouvelles tentatives de cette page.
  }
  return bookingIdempotencyKey;
}

function estimateFare(ageGroups) {
  return Object.entries(AGE_GROUP_PRICES).reduce((total, [group, price]) => total + ageGroups[group] * price, 0);
}

// Rappel du choix au-dessus du bouton : balade, date, personnes et estimation.
function updateBookingRecap() {
  if (!bookingRecap) return;
  const session = sessionsById.get(sessionSelect?.value || "");
  const { ageGroups } = readAgeGroups();
  const total = ageGroupTotal(ageGroups);
  if (!isPublicBooking() || !session) {
    bookingRecap.hidden = true;
    bookingRecap.replaceChildren();
    return;
  }
  const amount = estimateFare(ageGroups);
  bookingRecap.hidden = false;
  bookingRecap.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = session.walk;
  bookingRecap.append(
    "Votre réservation : ",
    title,
    ` — ${formatFrenchDate(session.date)}, ${session.slot} · ${pluralPlaces(session.remaining)} restantes`,
    total > 0 ? ` · ${total} personne${total > 1 ? "s" : ""} · ${amount} € (estimation)` : " · indiquez votre groupe",
  );
}

function updateAgeEstimate() {
  updateBookingRecap();
  if (!ageGroupInputs.length) return;
  const { ageGroups, valid } = readAgeGroups();
  const total = ageGroupTotal(ageGroups);
  syncBookingIdempotencySelection(sessionSelect?.value || "", total);
  const amount = estimateFare(ageGroups);
  if (participantsInput) participantsInput.value = String(total);
  if (participantsTotalOutput) participantsTotalOutput.textContent = String(total);
  if (bookingEstimateOutput) bookingEstimateOutput.textContent = total > 0 ? `${amount} €` : "—";
  const selected = sessionsById.get(sessionSelect?.value || "");
  const limit = currentBookingLimit(selected);
  const maxForSession = selected ? Math.min(limit, selected.remaining) : limit;
  ageGroupInputs.forEach((input) => { input.max = String(maxForSession); });
  if (!ageGroupStatus) return;
  if (total === 0 && !ageGroupsTouched) {
    ageGroupStatus.classList.remove("is-error");
    ageGroupStatus.textContent = "Renseignez votre groupe pour afficher le total et l’estimation.";
    return;
  }
  ageGroupStatus.classList.toggle("is-error", !valid || total < 1 || total > limit || (selected && total > selected.remaining));
  if (!valid) {
    ageGroupStatus.textContent = "Saisissez un nombre entier supérieur ou égal à zéro dans chaque tranche.";
  } else if (total < 1) {
    ageGroupStatus.textContent = "Indiquez au moins une personne pour estimer le montant.";
  } else if (total > limit) {
    ageGroupStatus.textContent = `Une visite est limitée à ${limit} personnes au total.`;
  } else if (selected && total > selected.remaining) {
    ageGroupStatus.textContent = `Il ne reste que ${selected.remaining} place${selected.remaining > 1 ? "s" : ""} pour cette date.`;
  } else {
    ageGroupStatus.textContent = "Estimation indicative selon les tarifs affichés; le paiement n’est pas effectué sur ce site.";
  }
}

ageGroupInputs.forEach((input) => input.addEventListener("input", () => {
  ageGroupsTouched = true;
  updateAgeEstimate();
}));

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

function setActiveProgramFilter(filter) {
  activeProgramFilter = filter === "available" && !availabilityLoaded ? "all" : filter;
  programFilterButtons.forEach((button) => {
    const active = button.dataset.programFilter === activeProgramFilter;
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("is-active", active);
  });
  applyProgramFilters();
}

function applyProgramFilters() {
  const query = normalizeSearchText(programSearchInput?.value || "").trim();
  let upcomingCount = 0;
  let visibleCount = 0;
  let visibleDateCount = 0;

  // Programme terminé : plus aucune date à venir, on affiche le message de fin de saison.
  const seasonOver = !programCards.some((card) => card.dataset.hasUpcoming === "true");

  programCards.forEach((card) => {
    if (seasonOver) {
      card.hidden = true;
      return;
    }
    const hasUpcoming = card.dataset.hasUpcoming === "true";
    if (hasUpcoming) upcomingCount += 1;
    const searchableText = normalizeSearchText(`${card.querySelector("h3")?.textContent || ""} ${card.querySelector(".program-kind")?.textContent || ""}`);
    const matchesSearch = !query || searchableText.includes(query);
    const upcomingDates = [...card.querySelectorAll("[data-program-date]:not([hidden])")];
    const availableDates = upcomingDates.filter((date) => date.dataset.soldOut === "false");
    const matchesAvailability = activeProgramFilter !== "available" || availableDates.length > 0;
    const visible = matchesSearch && matchesAvailability;
    card.hidden = !visible;
    if (visible) {
      visibleCount += 1;
      visibleDateCount += activeProgramFilter === "available" ? availableDates.length : upcomingDates.length;
    }
  });

  if (programEmpty) programEmpty.hidden = !seasonOver;
  if (programFilterEmpty) programFilterEmpty.hidden = seasonOver || visibleCount > 0;
  if (programResultCount) {
    if (seasonOver) {
      programResultCount.textContent = "Aucune date à venir.";
    } else if (activeProgramFilter === "available") {
      programResultCount.textContent = `${visibleCount} balade${visibleCount > 1 ? "s" : ""} · ${visibleDateCount} date${visibleDateCount > 1 ? "s" : ""} avec des places`;
    } else if (query) {
      programResultCount.textContent = `${visibleCount} résultat${visibleCount > 1 ? "s" : ""} pour « ${programSearchInput.value.trim()} »`;
    } else if (availabilityError) {
      programResultCount.textContent = `${visibleCount} balade${visibleCount > 1 ? "s" : ""} · disponibilités momentanément indisponibles`;
    } else if (availabilityLoaded) {
      programResultCount.textContent = `${visibleCount} balade${visibleCount > 1 ? "s" : ""} · ${visibleDateCount} date${visibleDateCount > 1 ? "s" : ""} au programme`;
    } else {
      programResultCount.textContent = `${visibleCount} balade${visibleCount > 1 ? "s" : ""} · chargement des places…`;
    }
  }
}

if (programSearchInput) programSearchInput.addEventListener("input", applyProgramFilters);
programFilterButtons.forEach((button) => button.addEventListener("click", () => setActiveProgramFilter(button.dataset.programFilter)));
if (clearProgramFiltersButton) {
  clearProgramFiltersButton.addEventListener("click", () => {
    if (programSearchInput) programSearchInput.value = "";
    setActiveProgramFilter("all");
    programSearchInput?.focus();
  });
}

function findSessionForTarget(target, kind = bookingKind()) {
  if (!target?.walk) return null;
  const matches = availabilitySessions.filter((session) => {
    if (session.ended) return false;
    if (sessionKind(session) !== kind) return false;
    if (session.walk !== target.walk) return false;
    if (target.date && session.date !== target.date) return false;
    if (target.slot && session.slot !== target.slot) return false;
    return true;
  });
  return matches.find((session) => session.remaining > 0) || null;
}

function updateSessionStatus() {
  if (!sessionStatus || !isPublicBooking()) {
    updateAgeEstimate();
    return;
  }
  if (!availabilityLoaded) {
    sessionStatus.textContent = availabilityError
      ? "Les disponibilités sont momentanément indisponibles. Réessayez ou contactez Marie-Tiyi."
      : "Chargement des disponibilités…";
    updateAgeEstimate();
    return;
  }
  const session = sessionsById.get(sessionSelect?.value || "");
  if (!session) {
    sessionStatus.textContent = "Sélectionnez une balade et une date ; les places restantes s’afficheront ici.";
    updateAgeEstimate();
    return;
  }
  if (session.remaining <= 0) {
    sessionStatus.textContent = "Cette visite est complète. Choisissez une autre date.";
    updateAgeEstimate();
    return;
  }
  sessionStatus.textContent = `Pour « ${session.walk} », le ${formatFrenchDate(session.date)} (${session.slot}), il reste ${pluralPlaces(session.remaining)} sur ${session.capacity}. Vous pouvez réserver jusqu’à ${session.remaining} personne${session.remaining > 1 ? "s" : ""}.`;
  if (bookingLock.walk && bookingLock.date) {
    sessionStatus.textContent += " Cette balade et cette date sont déjà choisies : indiquez seulement le nombre de personnes.";
  }
  updateAgeEstimate();
}

function renderSessionOptions(preferredId = "") {
  if (!sessionSelect) return;
  const previousId = preferredId || sessionSelect.value;
  sessionSelect.replaceChildren();
  // Un seul programme, et une seule balade quand elle est figée : seules ses
  // propres dates restent proposées.
  const kind = bookingKind();
  const sessionsProposees = availabilitySessions.filter(
    (session) => sessionKind(session) === kind && (!bookingLock.walk || session.walk === bookingLock.walk),
  );
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = sessionsProposees.length
    ? (bookingLock.walk ? "Choisissez une date" : "Choisissez une balade")
    : "Aucune date pour le moment";
  sessionSelect.append(placeholder);

  sessionsProposees.forEach((session) => {
    if (session.ended) return; // une balade terminée n’est plus proposée à la réservation
    const option = document.createElement("option");
    option.value = session.id;
    option.disabled = session.remaining <= 0;
    option.textContent = `${session.walk} — ${formatFrenchDate(session.date)} · ${session.slot} · ${session.remaining > 0 ? `${session.remaining} place${session.remaining > 1 ? "s" : ""} restante${session.remaining > 1 ? "s" : ""}` : "Complet"}`;
    sessionSelect.append(option);
  });

  if (previousId && sessionsById.has(previousId) && sessionsById.get(previousId).remaining > 0) {
    sessionSelect.value = previousId;
  } else {
    sessionSelect.value = "";
  }
  sessionSelect.disabled = !availabilityLoaded;
  if (pendingSessionTarget) {
    const match = findSessionForTarget(pendingSessionTarget);
    if (match) {
      sessionSelect.value = match.id;
      pendingSessionTarget = null;
      window.setTimeout(() => sessionSelect.focus({ preventScroll: true }), 0);
    } else if (availabilityLoaded && pendingSessionTarget.date) {
      const scheduled = availabilitySessions.some(
        (session) => sessionKind(session) === bookingKind()
          && session.date === pendingSessionTarget.date && session.walk === pendingSessionTarget.walk,
      );
      if (scheduled) {
        sessionStatus.textContent = "Cette date est complète. Choisissez une autre date disponible.";
        pendingSessionTarget = null;
      }
    }
  }
  updateBookingMode();
}

function updateProgramAvailability() {
  document.querySelectorAll("[data-program-date]").forEach((link) => {
    const card = link.closest("[data-program-card]");
    const walk = link.dataset.walk || card?.dataset.walk || "";
    const date = link.dataset.programDate || link.dateTime || "";
    const slot = link.dataset.slot || card?.dataset.slot || "";
    const session = sessionsById.get(makeSessionId(date, walk, slot));
    const label = link.querySelector("[data-availability-label]");
    if (!session) {
      if (label && !link.hidden) label.textContent = availabilityError ? "Indisponible" : "Non ouvert";
      link.classList.toggle("is-unavailable", availabilityError && !link.hidden);
      link.classList.remove("is-sold-out");
      link.dataset.soldOut = "";
      link.removeAttribute("aria-disabled");
      link.removeAttribute("tabindex");
      delete link.dataset.sessionId;
      return;
    }
    const ended = session.ended === true || (sessionEndMoment(date, slot) || 0) <= Date.now();
    const available = !ended && session.remaining > 0;
    if (label) label.textContent = ended ? "Terminée" : available ? `${session.remaining} place${session.remaining > 1 ? "s" : ""}` : "Complet";
    link.classList.toggle("is-sold-out", !available);
    link.classList.toggle("is-ended", ended);
    link.classList.remove("is-unavailable");
    link.dataset.soldOut = String(!available);
    link.dataset.ended = String(ended);
    link.dataset.sessionId = session.id;
    link.setAttribute("aria-disabled", String(!available));
    if (!available) link.tabIndex = -1;
    else link.removeAttribute("tabindex");
    const dateLabel = link.dataset.fullDate || link.querySelector("time")?.textContent || date;
    const details = link.querySelector("[data-availability-details]");
    if (details) {
      const state = ended ? "terminée" : available ? `${pluralPlaces(session.remaining)} restantes sur ${session.capacity}, réserver` : "complet";
      details.textContent = `${walk} — ${dateLabel} : ${state}.`;
    }
  });

  programCards.forEach((card) => {
    const dates = [...card.querySelectorAll("[data-program-date]:not([hidden])")];
    const noDate = dates.length === 0;
    const allFull = dates.length > 0 && dates.every((link) => link.dataset.soldOut === "true");
    const allEnded = allFull && dates.every((link) => link.dataset.ended === "true");
    const cta = card.querySelector(".program-cta");
    if (cta) {
      // Sans date à venir, la balade reste au programme : on invite à en demander une.
      cta.dataset.interest = noDate ? "J’ai une autre question" : PUBLIC_TOPIC;
      cta.dataset.allSoldOut = String(allFull);
      cta.setAttribute("aria-disabled", String(allFull));
      if (allFull) cta.tabIndex = -1;
      else cta.removeAttribute("tabindex");
      if (cta.firstChild?.nodeType === Node.TEXT_NODE) {
        cta.firstChild.textContent = noDate ? "Demander une prochaine date " : allEnded ? "Dates terminées " : allFull ? "Toutes les dates sont complètes " : "Réserver une place ";
      }
    }
  });
  if (availableFilterButton) availableFilterButton.disabled = !availabilityLoaded;
  applyProgramFilters();
  syncInspirationTrack();
  updateNextWalk();
  updateProgramCounts();
}

function renderAvailability(payload) {
  availabilitySessions = (payload.sessions || []).filter((session) => !sessionIsHidden(session.date, session.slot));
  sessionsById.clear();
  availabilitySessions.forEach((session) => sessionsById.set(session.id, session));
  availabilityLoaded = true;
  availabilityError = false;
  updateProgramAvailability();
  renderSessionOptions();
  syncOfferPlaces();
}

// ------------------------------------------------------------------ Agenda Google
// Le programme du site reste la base : si l’agenda est injoignable (hors ligne,
// iPhone en veille, service indisponible), rien ne change. Quand il répond, ses
// dates corrigent l’affichage : une date supprimée dans l’agenda disparaît, une
// date ajoutée ou déplacée apparaît. Aucune donnée personnelle n’est lue.
let agendaApplied = false;

const agendaKey = (date, walk) => `${date}|${walk}`;

/** Ajoute la pastille d’une date venue de l’agenda, à sa place chronologique. */
function addAgendaDate(card, session) {
  const container = card.querySelector(".program-dates");
  const template = card.querySelector("[data-program-date]");
  if (!container || !template) return null;
  const link = template.cloneNode(true);
  link.hidden = false;
  delete link.dataset.sessionId;
  delete link.dataset.agendaRemoved;
  link.dataset.soldOut = "";
  link.dataset.ended = "false";
  link.removeAttribute("aria-disabled");
  link.removeAttribute("tabindex");
  link.classList.remove("is-sold-out", "is-ended", "is-unavailable");
  link.dataset.programDate = session.date;
  link.dataset.date = session.date;
  link.dataset.walk = session.walk;
  link.dataset.slot = session.slot;
  link.dataset.fullDate = formatFrenchDate(session.date, false);
  const [year, month, day] = session.date.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const time = link.querySelector("time");
  if (time) time.setAttribute("datetime", session.date);
  const dayOutput = link.querySelector(".program-date-day");
  if (dayOutput) dayOutput.textContent = String(day);
  const weekdayOutput = link.querySelector(".program-date-weekday");
  if (weekdayOutput) {
    weekdayOutput.textContent = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "");
  }
  const monthOutput = link.querySelector(".program-date-month");
  if (monthOutput) monthOutput.textContent = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(date);
  const label = link.querySelector("[data-availability-label]");
  if (label) label.textContent = "Chargement…";
  const details = link.querySelector("[data-availability-details]");
  if (details) details.textContent = "Réserver cette balade";
  const next = [...container.querySelectorAll("[data-program-date]:not([hidden])")]
    .find((other) => (other.dataset.programDate || "") > session.date);
  container.insertBefore(link, next || null);
  return link;
}

/** Applique la liste des dates de l’agenda ; renvoie vrai si l’affichage change. */
function applyAgendaSessions(sessions) {
  if (agendaApplied) return false;
  agendaApplied = true;
  const wanted = new Map();
  sessions.forEach((session) => {
    if (!session || !/^\d{4}-\d{2}-\d{2}$/.test(session.date || "") || !session.walk) return;
    wanted.set(agendaKey(session.date, session.walk), session);
  });
  if (!wanted.size) return false;
  let changed = false;
  programCards.forEach((card) => {
    const walk = card.dataset.walk || "";
    const present = new Set();
    [...card.querySelectorAll("[data-program-date]")].forEach((link) => {
      const date = link.dataset.programDate || "";
      if (!wanted.has(agendaKey(date, link.dataset.walk || walk))) {
        // Supprimée ou déplacée dans l’agenda : elle quitte le site.
        if (!link.hidden) {
          link.hidden = true;
          changed = true;
        }
        link.dataset.agendaRemoved = "true";
      } else {
        present.add(date);
      }
    });
    [...wanted.values()]
      .filter((session) => session.walk === walk && !present.has(session.date)
        && !sessionIsHidden(session.date, session.slot))
      .forEach((session) => {
        addAgendaDate(card, session);
        changed = true;
      });
    refreshProgramCard(card);
  });
  if (!changed) return false;
  updateProgramCounts();
  updateNextWalk();
  buildInspirationTrack();
  applyProgramFilters();
  updateProgramAvailability();
  loadAvailability(); // places des dates ajoutées dans l’agenda
  return true;
}

/** Adresse d’une route de lecture de l’API (serveur local ou Web App). */
function readApiUrl(base, name) {
  return base ? `${base}?api=${name}` : `/api/${name}`;
}

/**
 * Lit une route de l’API. En aperçu, si le serveur Python n’est pas joignable
 * ( route absente ou réseau), on bascule une fois pour toutes sur la Web App.
 */
async function readApi(name) {
  const bases = [activeApiBase, ...API_BASES.filter((base) => base !== activeApiBase)];
  let lastError = null;
  for (let index = 0; index < bases.length; index += 1) {
    const base = bases[index];
    try {
      const response = await fetch(readApiUrl(base, name), {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      // Route absente ou page HTML renvoyée à la place du JSON : on essaie l’autre API.
      const type = response.headers?.get?.("content-type") || "";
      const json = !type || type.includes("json");
      if (index < bases.length - 1 && (!json || [404, 405, 501].includes(response.status))) continue;
      activeApiBase = base;
      return response;
    } catch (error) {
      lastError = error;
      if (index === bases.length - 1) throw error;
    }
  }
  throw lastError || new Error("API indisponible");
}

/** Lit les dates de l’agenda (facultatif : le site fonctionne sans). */
async function loadAgendaSchedule() {
  try {
    const response = await readApi("schedule");
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload || payload.agenda !== true || !Array.isArray(payload.sessions)) return;
    applyAgendaSessions(payload.sessions);
  } catch (error) {
    // Hors ligne, service indisponible ou agenda vide : le programme statique reste.
    console.info("Agenda non consulté : le programme du site reste affiché.", error);
  }
}

async function loadAvailability() {
  if (availabilityRequest) return availabilityRequest;
  availabilityRequest = (async () => {
    try {
      const response = await readApi("availability");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      // Apps Script répond toujours 200 : une erreur arrive dans le corps de la réponse.
      if (payload.error || !Array.isArray(payload.sessions)) throw new Error(payload.message || "Réponse de disponibilités invalide");
      renderAvailability(payload);
    } catch (error) {
      availabilityLoaded = false;
      availabilityError = true;
      availabilitySessions = [];
      sessionsById.clear();
      if (activeProgramFilter === "available") setActiveProgramFilter("all");
      updateProgramAvailability();
      if (sessionSelect) {
        sessionSelect.replaceChildren();
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Disponibilités temporairement indisponibles";
        sessionSelect.append(option);
      }
      updateBookingMode();
      console.error("Impossible de charger les disponibilités.", error);
    } finally {
      availabilityRequest = null;
    }
  })();
  return availabilityRequest;
}

if (sessionSelect) {
  sessionSelect.addEventListener("change", () => {
    updateFormStatus("");
    updateSessionStatus();
  });
}

function chooseSession(target) {
  if (!sessionSelect || !target?.walk) return;
  if (!availabilityLoaded) {
    pendingSessionTarget = target;
    return;
  }
  const session = findSessionForTarget(target);
  if (session) {
    sessionSelect.value = session.id;
    updateSessionStatus();
  } else {
    sessionSelect.value = "";
    if (sessionStatus && isPublicBooking()) {
      sessionStatus.textContent = target.date
        ? "Cette date est complète ou indisponible. Choisissez une autre date."
        : "Toutes les dates de cette balade sont complètes. Choisissez un autre thème ou contactez Marie-Tiyi.";
    }
  }
  syncBookingIdempotencySelection(sessionSelect.value, ageGroupTotal(readAgeGroups().ageGroups));
}

if (messageInput) {
  messageInput.addEventListener("input", () => {
    messageInput.dataset.prefilled = "false";
  });
}

function getSelectedSession() {
  return sessionsById.get(sessionSelect?.value || "") || null;
}

function updateFormStatus(message, state = "info") {
  if (!formStatus) return;
  formStatus.textContent = message;
  if (message) formStatus.dataset.state = state;
  else delete formStatus.dataset.state;
  // Confirmation ou erreur : on amène le message dans la fenêtre de réservation.
  if (message && bookingDialog?.open) {
    formStatus.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// Un champ rempli uniquement d'espaces ne compte pas comme une saisie.
const cleanField = (value) => String(value || "").trim().replace(/\s+/g, " ");

// Formats français (06 12 34 56 78) et internationaux (+33 6 12 34 56 78).
const PHONE_ALLOWED = /^[0-9+ ().\-\/]+$/;
function validPhone(value) {
  const text = cleanField(value);
  if (!text || !PHONE_ALLOWED.test(text)) return false;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return false;
  if (/^0+$/.test(digits)) return false;
  return true;
}

if (contactForm) {
  contactForm.querySelectorAll("input, textarea").forEach((field) => field.addEventListener("input", () => {
    if (["error", "success"].includes(formStatus?.dataset.state)) updateFormStatus("");
  }));
}

async function submitPublicBooking(values) {
  if (!availabilityLoaded) {
    updateFormStatus("La réservation en ligne est momentanément indisponible. Réessayez dans quelques instants ou contactez Marie-Tiyi.", "error");
    await loadAvailability();
    return;
  }
  const session = getSelectedSession();
  const { ageGroups, valid: ageGroupsValid } = readAgeGroups();
  const participants = ageGroupTotal(ageGroups);
  ageGroupsTouched = true;
  updateAgeEstimate();
  if (!contactForm.reportValidity()) return;
  if (!session || session.remaining <= 0) {
    updateFormStatus("Choisissez une date disponible pour réserver.", "error");
    sessionSelect?.focus();
    return;
  }
  const limit = currentBookingLimit(session);
  if (!ageGroupsValid || participants < 1 || participants > limit) {
    updateFormStatus(`Répartissez les participants par tarif; une visite est limitée à ${limit} personnes au total.`, "error");
    ageGroupInputs.find((input) => !input.validity.valid)?.focus();
    return;
  }
  if (participants > session.remaining) {
    updateFormStatus(`Il ne reste que ${session.remaining} place(s) pour cette date. Réduisez le nombre de personnes ou choisissez une autre balade.`, "error");
    ageGroupInputs[0]?.focus();
    await loadAvailability();
    return;
  }

  const firstName = cleanField(values.get("first_name"));
  const lastName = cleanField(values.get("last_name"));
  const email = cleanField(values.get("email"));
  const phone = cleanField(values.get("phone"));
  const message = String(values.get("message") || "").trim();
  if (!firstName) {
    updateFormStatus("Indiquez votre prénom.", "error");
    firstNameInput?.focus();
    return;
  }
  if (!lastName) {
    updateFormStatus("Indiquez votre nom.", "error");
    lastNameInput?.focus();
    return;
  }
  if (!phone) {
    updateFormStatus("Indiquez votre numéro de téléphone : il permet de vous joindre le jour de la balade.", "error");
    phoneInput?.focus();
    return;
  }
  if (!validPhone(phone)) {
    updateFormStatus("Ce numéro de téléphone semble incomplet. Exemple : 06 12 34 56 78.", "error");
    phoneInput?.focus();
    return;
  }
  if (!email) return;

  const idempotencyKey = getBookingIdempotencyKey(session.id, participants);
  if (submitButton) submitButton.disabled = true;
  hideCalendarLink();
  updateFormStatus("Enregistrement de votre réservation…", "pending");
  try {
    // Apps Script : text/plain évite le pré-vol CORS ; la réponse reste lisible en JSON.
    const response = await fetch(activeApiBase || "/api/bookings", {
      method: "POST",
      headers: activeApiBase
        ? { "Content-Type": "text/plain;charset=utf-8" }
        : { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        session_id: session.id, first_name: firstName, last_name: lastName,
        email, phone, message, participants, age_groups: ageGroups,
        idempotency_key: idempotencyKey,
        website: String(values.get("website") || ""),
      }),
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      updateFormStatus(result.message || "La réservation n’a pas pu être confirmée. Vérifiez les places disponibles et réessayez.", "error");
      await loadAvailability();
      return;
    }
    updateFormStatus(`Réservation confirmée pour ${result.walk}, le ${formatFrenchDate(result.date)} à ${result.slot} (${result.participants} personne${result.participants > 1 ? "s" : ""}, estimation ${result.price_estimate} €). Référence : ${result.reference}. Il reste ${result.remaining} place${result.remaining > 1 ? "s" : ""}. Un e-mail de confirmation vient de vous être envoyé : conservez votre référence, elle suffit pour annuler ou modifier.`, "success");
    // « Ajouter à mon agenda » n'apparaît qu'après une réservation réellement confirmée.
    showCalendarLink({
      walk: result.walk,
      date: result.date,
      slot: result.slot,
      reference: result.reference,
      participants: result.participants,
    });
    if (sessionSelect) sessionSelect.value = "";
    ageGroupInputs.forEach((input) => { input.value = "0"; });
    clearBookingIdempotencyKey();
    ageGroupsTouched = false;
    updateAgeEstimate();
    await loadAvailability();
  } catch (error) {
    console.error("Échec de la réservation.", error);
    updateFormStatus("Impossible de joindre le service de réservation. Réessayez ou contactez Marie-Tiyi par e-mail.", "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function submitCustomRequest(values) {
  const firstName = cleanField(values.get("first_name"));
  const lastName = cleanField(values.get("last_name"));
  const email = cleanField(values.get("email"));
  const topic = String(values.get("topic") || "").trim();
  const date = String(values.get("date") || "").trim();
  const participants = String(values.get("custom_participants") || "").trim();
  const slot = String(values.get("slot") || "").trim();
  const message = String(values.get("message") || "").trim();
  const phone = cleanField(values.get("phone"));
  if (!firstName) {
    updateFormStatus("Indiquez votre prénom.", "error");
    firstNameInput?.focus();
    return;
  }
  if (!lastName) {
    updateFormStatus("Indiquez votre nom.", "error");
    lastNameInput?.focus();
    return;
  }
  if (!phone) {
    updateFormStatus("Indiquez votre numéro de téléphone : il permet de vous joindre facilement.", "error");
    phoneInput?.focus();
    return;
  }
  if (!validPhone(phone)) {
    updateFormStatus("Ce numéro de téléphone semble incomplet. Exemple : 06 12 34 56 78.", "error");
    phoneInput?.focus();
    return;
  }
  const customLimit = customCapacityForTopic(topic);
  if (participants && (!/^\d+$/.test(participants) || Number(participants) < 1 || Number(participants) > customLimit)) {
    updateFormStatus(
      customLimit === GROUP_CAPACITY
        ? "Un groupe de seniors ou une visite en famille est limité à 20 personnes."
        : "Indiquez un nombre de personnes compris entre 1 et 100.",
      "error"
    );
    customParticipantsInput?.focus();
    return;
  }
  if (!email) return;

  if (submitButton) submitButton.disabled = true;
  hideCalendarLink();
  updateFormStatus("Envoi de votre demande…", "pending");
  try {
    const response = await fetch(activeApiBase || "/api/bookings", {
      method: "POST",
      headers: activeApiBase
        ? { "Content-Type": "text/plain;charset=utf-8" }
        : { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        type: "custom_request",
        topic,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        date,
        slot,
        participants,
        message,
        website: String(values.get("website") || ""),
      }),
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      updateFormStatus(result.message || "La demande n’a pas pu être envoyée. Réessayez ou contactez Marie-Tiyi par téléphone.", "error");
      return;
    }
    updateFormStatus(result.message || "Votre demande a bien été envoyée à Marie-Tiyi. Un e-mail récapitulatif vient de vous être adressé (pensez à vérifier vos indésirables).", "success");
    if (dateInput) dateInput.value = "";
    if (customParticipantsInput) customParticipantsInput.value = "";
    if (messageInput) {
      messageInput.value = "";
      messageInput.dataset.prefilled = "false";
    }
  } catch (error) {
    console.error("Échec de l’envoi de la demande sur mesure.", error);
    updateFormStatus("Impossible d’envoyer la demande pour le moment. Vous pouvez appeler Marie-Tiyi au 06 01 74 04 49 ou écrire à balades.culturelles@gmail.com.", "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

if (contactForm && formStatus) {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (lockedTopicInput) lockedTopicInput.value = topicSelect?.value || "";
    if (isPublicBooking()) {
      await submitPublicBooking(new FormData(contactForm));
      return;
    }
    if (!contactForm.reportValidity()) return;
    await submitCustomRequest(new FormData(contactForm));
  });
}

applyProgramFilters();
updateBookingMode();
openBookingFromUrl();
// Les disponibilités ne sont utiles que là où l'on choisit une date.
const needsAvailability = programCards.length > 0 || Boolean(contactForm);
if (needsAvailability) {
  loadAvailability();
  loadAgendaSchedule();
  // Google Apps Script : interrogé moins souvent pour rester dans les quotas gratuits.
  window.setInterval(loadAvailability, IS_PUBLISHED_SITE ? 120_000 : 30_000);
  window.addEventListener("focus", loadAvailability);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadAvailability();
  });
}

const year = document.querySelector("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());

const legalDialog = document.querySelector("#legal-dialog");
const legalContent = legalDialog?.querySelector(".legal-dialog-content");
const legalRailLinks = legalDialog ? [...legalDialog.querySelectorAll("[data-legal-jump]")] : [];
const legalArticles = legalContent ? [...legalContent.querySelectorAll("[data-legal-article]")] : [];
const legalTargets = { "legal-mentions": "mentions", "legal-confidentialite": "confidentialite" };

function legalTargetFromHash() {
  return legalTargets[window.location.hash.slice(1)] || "";
}

function scrollLegalTo(articleId) {
  const article = legalArticles.find((item) => item.dataset.legalArticle === articleId);
  if (!article || !legalContent) return;
  legalContent.scrollTop = Math.max(0, article.offsetTop - 10);
}

function markLegalCurrent(articleId) {
  legalRailLinks.forEach((link) => {
    if (link.dataset.legalJump === articleId) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

function openLegalDialog(articleId) {
  if (!legalDialog) return;
  const target = articleId || legalRailLinks[0]?.dataset.legalJump;
  if (!legalDialog.open) {
    if (typeof legalDialog.showModal === "function") legalDialog.showModal();
    else {
      legalDialog.classList.add("is-fallback");
      legalDialog.setAttribute("open", "");
    }
  }
  if (target) {
    window.requestAnimationFrame(() => {
      scrollLegalTo(target);
      markLegalCurrent(target);
    });
  }
  legalDialog.querySelector("[data-legal-close]")?.focus();
}

function closeLegalDialog() {
  if (!legalDialog?.open) return;
  if (typeof legalDialog.close === "function") legalDialog.close();
  else {
    legalDialog.classList.remove("is-fallback");
    legalDialog.removeAttribute("open");
    legalDialog.dispatchEvent(new window.Event("close"));
  }
}

legalDialog?.addEventListener("click", (event) => {
  if (event.target === legalDialog) closeLegalDialog();
});
legalDialog?.querySelector("[data-legal-close]")?.addEventListener("click", closeLegalDialog);
legalDialog?.addEventListener("close", () => {
  if (legalTargetFromHash()) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
});

legalRailLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    scrollLegalTo(link.dataset.legalJump);
    markLegalCurrent(link.dataset.legalJump);
  });
});

legalContent?.addEventListener("scroll", () => {
  const visible = legalArticles.filter((article) => article.offsetTop - legalContent.scrollTop <= 40);
  const current = visible[visible.length - 1];
  if (current) markLegalCurrent(current.dataset.legalArticle);
});

document.addEventListener("click", (event) => {
  const trigger = event.target instanceof Element ? event.target.closest("[data-legal-open]") : null;
  if (!trigger) return;
  event.preventDefault();
  openLegalDialog(trigger.dataset.legalOpen);
});

window.addEventListener("hashchange", () => {
  const target = legalTargetFromHash();
  if (target) openLegalDialog(target);
});
if (legalTargetFromHash()) openLegalDialog(legalTargetFromHash());

function renderWalkDialogDates(walkName) {
  if (!walkDialogDates || !walkDialogFoot) return;
  const programCard = programCards.find((card) => card.dataset.walk === walkName);
  const liensDates = [...(programCard?.querySelectorAll("[data-program-date]") || [])]
    .filter((lien) => !lien.hidden)
    .sort((a, b) => (a.dataset.programDate || "").localeCompare(b.dataset.programDate || ""));
  walkDialogDates.replaceChildren();
  walkDialogFoot.hidden = liensDates.length === 0;

  liensDates.forEach((lien) => {
    const date = lien.dataset.programDate || "";
    const slot = lien.dataset.slot || programCard?.dataset.slot || "";
    const dateComplete = lien.dataset.fullDate || date;
    const weekday = lien.querySelector(".program-date-weekday")?.textContent?.trim() || "";
    const complet = lien.dataset.soldOut === "true";
    const places = complet
      ? "Indisponible"
      : lien.querySelector("[data-availability-label]")?.textContent?.trim() || "Places disponibles";

    const boutonDate = document.createElement("a");
    boutonDate.className = `walk-dialog-date-btn${complet ? " is-sold-out" : ""}`;
    boutonDate.href = "contact.html";
    boutonDate.dataset.soldOut = complet ? "true" : "";
    boutonDate.dataset.interest = PUBLIC_TOPIC;
    boutonDate.dataset.walk = walkName;
    boutonDate.dataset.date = date;
    boutonDate.dataset.slot = slot;
    boutonDate.setAttribute("aria-disabled", String(complet));
    boutonDate.innerHTML = `<span>Réserver le ${escapeHtml(weekday)} ${escapeHtml(dateComplete)}</span><small>${escapeHtml(formatSlot(slot))} · ${escapeHtml(places)}</small>`;
    // Le clic est traité par le gestionnaire global : la fiche se referme et la
    // fenêtre de réservation s'ouvre sur cette date (ou affiche « Indisponible »).
    boutonDate.addEventListener("click", () => closeWalkDialog());
    walkDialogDates.append(boutonDate);
  });
}

function openWalkDialog(walkName) {
  if (!walkDialog || !walkName) return;
  walkDialog.dataset.currentWalk = walkName;
  const programCard = programCards.find((card) => card.dataset.walk === walkName);
  const kind = programCard?.querySelector(".program-kind")?.textContent?.trim() || "Présentation de la balade";
  const summary = programCard?.dataset.summary || "";

  if (walkDialogTitle) walkDialogTitle.textContent = walkName;
  if (walkDialogKicker) walkDialogKicker.textContent = kind;

  const matchingArticle = walkArticles.find((article) => article.dataset.walkArticle === walkName);
  walkArticles.forEach((article) => {
    article.hidden = article !== matchingArticle;
  });
  if (walkFallbackArticle) {
    walkFallbackArticle.hidden = Boolean(matchingArticle);
    if (!matchingArticle && walkFallbackText) walkFallbackText.textContent = summary;
  }

  renderWalkDialogDates(walkName);

  if (!walkDialog.open) {
    if (typeof walkDialog.showModal === "function") walkDialog.showModal();
    else {
      walkDialog.classList.add("is-fallback");
      walkDialog.setAttribute("open", "");
    }
  }
  if (walkDialogContent) walkDialogContent.scrollTop = 0;
  walkDialog.querySelector("[data-walk-close]")?.focus();
}

function closeWalkDialog() {
  if (!walkDialog?.open) return;
  if (typeof walkDialog.close === "function") walkDialog.close();
  else {
    walkDialog.classList.remove("is-fallback");
    walkDialog.removeAttribute("open");
    walkDialog.dispatchEvent(new window.Event("close"));
  }
}

walkDialog?.addEventListener("click", (event) => {
  if (event.target === walkDialog) closeWalkDialog();
});
walkDialog?.querySelector("[data-walk-close]")?.addEventListener("click", closeWalkDialog);

document.addEventListener("click", (event) => {
  const trigger = event.target instanceof Element ? event.target.closest("[data-walk-open]") : null;
  if (!trigger) return;
  event.preventDefault();
  openWalkDialog(trigger.dataset.walkOpen);
});

