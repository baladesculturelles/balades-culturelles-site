// Balades Culturelles — site vitrine.
// La réservation en ligne est désactivée : le site présente les balades et leurs
// dates, et l’inscription se fait par téléphone ou par e-mail (page contact).
// L’ancienne version (formulaire, places restantes, moteur Google) reste
// disponible dans l’historique Git si la réservation en ligne revient.

const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#primary-navigation");

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

// Sous-menu « Balades culturelles » au tactile sans survol (tablette et
// téléphone en paysage, > 760 px) : le premier tap ouvre le sous-menu au
// lieu de naviguer tout de suite vers balades.html — ses liens (Tout
// public, Seniors, Familles…) étaient sinon inatteignables au doigt.
// Le second tap suit le lien ; un tap ailleurs referme. Sur téléphone
// portrait (≤ 760 px), le sous-menu est déjà déplié dans le panneau.
if (navigation) {
  const sousMenuSansSurvol = window.matchMedia("(min-width: 761px) and (hover: none)");
  navigation.querySelectorAll(".nav-item-dropdown").forEach((item) => {
    const toggle = item.querySelector(".nav-dropdown-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", (event) => {
      if (!sousMenuSansSurvol.matches || item.classList.contains("is-subopen")) return;
      event.preventDefault();
      // Évite au clic « ouverture » de marquer l'onglet comme page en cours.
      event.stopPropagation();
      item.classList.add("is-subopen");
      toggle.setAttribute("aria-expanded", "true");
    });
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".nav-item-dropdown.is-subopen")) return;
    navigation.querySelectorAll(".nav-item-dropdown.is-subopen").forEach((item) => {
      item.classList.remove("is-subopen");
      item.querySelector(".nav-dropdown-toggle")?.setAttribute("aria-expanded", "false");
    });
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

// ------------------------------------------------------------------ Dates du programme
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

function sessionIsHidden(isoDate, slot, now = Date.now()) {
  if (!isoDate) return false;
  const [year, month, day] = isoDate.split("-").map(Number);
  const { end } = slotBounds(slot);
  return now >= parisMoment(year, month, day, end[0], end[1]) + VISIBLE_HOURS_AFTER_END * 3_600_000;
}

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** « 10 h 30–12 h » → « 10 h 30 – 12 h » : lisible et respiré. */
function formatSlot(slot) {
  return String(slot || "").replace(/\s*[–-]\s*/g, " – ").trim();
}

function formatFrenchDate(isoDate, includeWeekday = true) {
  const options = { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" };
  if (includeWeekday) options.weekday = "long";
  const label = new Intl.DateTimeFormat("fr-FR", options).format(new Date(`${isoDate}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** « 2027-01-28 » → { jour: "28", semaine: "jeu.", mois: "janv." } */
function shortDateParts(isoDate) {
  const moment = new Date(`${isoDate}T12:00:00Z`);
  const format = (options) => new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }).format(moment);
  return { jour: format({ day: "numeric" }), semaine: format({ weekday: "short" }), mois: format({ month: "short" }) };
}

/** Une date, présentée comme une étiquette (information seule, pas un lien). */
function datePillHtml(isoDate) {
  const { jour, semaine, mois } = shortDateParts(isoDate);
  return `<span class="next-card-date-pill" title="${escapeHtml(formatFrenchDate(isoDate))}"><span class="next-card-date-chip"><b>${escapeHtml(jour)}</b> ${escapeHtml(semaine)} ${escapeHtml(mois)}</span></span>`;
}

/** « 28 & 29 nov. 2026 », « 31 janv. & 1 févr. 2027 » ou « 12 déc. 2026 ». */
function formatPeriod(dates) {
  if (!dates.length) return "";
  const lire = (iso) => ({ ...shortDateParts(iso), annee: iso.slice(0, 4) });
  const premier = lire(dates[0]);
  if (dates.length === 1) return `${premier.jour} ${premier.mois} ${premier.annee}`;
  const dernier = lire(dates[dates.length - 1]);
  if (premier.mois === dernier.mois && premier.annee === dernier.annee) {
    return `${premier.jour} & ${dernier.jour} ${premier.mois} ${premier.annee}`;
  }
  return `${premier.jour} ${premier.mois} & ${dernier.jour} ${dernier.mois} ${dernier.annee}`;
}

// Les balades tout public sont décrites dans les cartes (masquées) de balades.html :
// titre, thème, photo, résumé et dates. Ce sont elles qui alimentent le carrousel.
const programCards = [...document.querySelectorAll("[data-program-card]")];

function upcomingDates(card) {
  return [...card.querySelectorAll("[data-program-date]")]
    .map((element) => element.dataset.programDate || "")
    .filter((date) => date && !sessionIsHidden(date, card.dataset.slot))
    .sort();
}

function publicWalkInfos(walk) {
  const card = programCards.find((item) => (item.dataset.walk || "") === walk);
  if (!card) return null;
  return {
    walk,
    image: card.dataset.image || "",
    imageAlt: card.dataset.imageAlt || walk,
    summary: card.dataset.summary || "",
    kind: card.querySelector(".program-kind")?.textContent?.trim() || "",
    slot: card.dataset.slot || "",
  };
}

// Dimensions intrinsèques des photos : réservent la place avant le chargement (anti-CLS).
const WALK_IMAGE_SIZES = Object.freeze({
  "walk-bridges": [1376, 768],
  "walk-grands-magasins": [800, 907],
  "walk-moliere": [800, 854],
  "walk-passages-couverts": [1080, 1080],
});

/** Photo d’une balade, avec ses variantes WebP. */
function walkMediaHtml(image, imageAlt, badge, periode) {
  const imageStem = image.split("/").pop().replace(/\.jpg$/i, "");
  const [width, height] = WALK_IMAGE_SIZES[imageStem] || [800, 500];
  return `
      <div class="next-card-media">
        <picture><source type="image/webp" sizes="(max-width: 560px) 86vw, (max-width: 980px) 45vw, 380px" srcset="assets/responsive/${escapeHtml(imageStem)}-400.webp 400w, assets/responsive/${escapeHtml(imageStem)}-480.webp 480w, assets/responsive/${escapeHtml(imageStem)}-800.webp 800w"><img class="next-card-image" src="${escapeHtml(image)}" width="${width}" height="${height}" alt="${escapeHtml(imageAlt)}" loading="lazy" decoding="async"></picture>
        <span class="next-card-badge">${escapeHtml(badge)}</span>
        <span class="next-card-period">${escapeHtml(periode)}</span>
      </div>`;
}

/** Une carte de carrousel : photo (si connue), thème, titre, résumé, horaires et dates. */
function walkCardHtml({ walk, kind, summary, slot, dates, media, openable }) {
  const titre = openable
    ? `<button type="button" class="next-card-title-link" data-walk-open="${escapeHtml(walk)}">${escapeHtml(walk)}</button>`
    : escapeHtml(walk);
  return `${media}
      <div class="next-card-body">
        <span class="next-card-kind">${escapeHtml(kind)}</span>
        <h3 class="next-card-title">${titre}</h3>
        <p class="next-card-summary">${escapeHtml(summary)}</p>
        <p class="next-card-time"><span class="next-card-time-label">Horaires</span> <strong>${escapeHtml(formatSlot(slot))}</strong></p>
        <div class="next-card-dates" aria-label="Dates pour ${escapeHtml(walk)}">${dates.map(datePillHtml).join("")}</div>
      </div>`;
}

function emptyCard(className) {
  const vide = document.createElement("li");
  vide.className = `next-card ${className}`;
  vide.innerHTML = '<div class="next-card-body"><p class="next-card-summary">Le programme de la saison prochaine sera annoncé ici.</p></div>';
  return vide;
}

// Câblage commun des carrousels : flèches, pas de défilement et état des boutons.
function setupCarousel(track, prevBtn, nextBtn) {
  const updateButtons = () => {
    const max = track.scrollWidth - track.clientWidth - 2;
    if (prevBtn) prevBtn.disabled = track.scrollLeft <= 2;
    if (nextBtn) nextBtn.disabled = track.scrollLeft >= max;
  };
  const scroll = (dir) => {
    const carte = track.querySelector(".next-card");
    if (!carte) return;
    const ecart = parseFloat(window.getComputedStyle(track).columnGap || "13") || 13;
    track.scrollBy({ left: dir * (carte.getBoundingClientRect().width + ecart), behavior: "smooth" });
  };
  prevBtn?.addEventListener("click", () => scroll(-1));
  nextBtn?.addEventListener("click", () => scroll(1));
  track.addEventListener("scroll", updateButtons, { passive: true });
  window.addEventListener("resize", updateButtons);
  updateButtons();
}

/** Carrousel tout public : une carte par balade ayant encore une date, dans l’ordre des dates. */
function buildPublicTrack(track) {
  const balades = programCards
    .map((card) => ({ card, dates: upcomingDates(card) }))
    .filter((entree) => entree.dates.length > 0)
    .sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
  track.replaceChildren();
  if (!balades.length) track.append(emptyCard(""));
  balades.forEach(({ card, dates }, index) => {
    const infos = publicWalkInfos(card.dataset.walk || "");
    const li = document.createElement("li");
    li.className = "next-card";
    li.dataset.walk = infos.walk;
    li.innerHTML = walkCardHtml({
      ...infos,
      dates,
      media: walkMediaHtml(infos.image, infos.imageAlt, String(index + 1).padStart(2, "0"), formatPeriod(dates)),
      openable: true,
    });
    track.append(li);
  });
}

// Programme seniors et familles : un seul endroit à modifier, le bloc
// <script id="programme-extra"> de balades.html.
function extraSessions(kind) {
  const source = document.querySelector("#programme-extra");
  if (!source) return [];
  try {
    const data = JSON.parse(source.textContent || "{}");
    return (data.sessions || [])
      .filter((session) => session.kind === kind && /^\d{4}-\d{2}-\d{2}$/.test(session.date || "") && session.walk)
      .filter((session) => !sessionIsHidden(session.date, session.slot))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    console.error("Programme seniors / familles illisible.", error);
    return [];
  }
}

// Certaines balades seniors reprennent une balade du week-end sous un autre titre.
const SENIOR_WALK_ALIASES = Object.freeze({
  "La muraille de Philippe Auguste": "Sur les traces de l’enceinte de Philippe Auguste",
});

/** Carrousel seniors : une carte par date, avec la photo de la balade du week-end si elle existe. */
function buildSeniorTrack(track) {
  const sessions = extraSessions("seniors");
  track.replaceChildren();
  if (!sessions.length) track.append(emptyCard("senior-card"));
  sessions.forEach((session, index) => {
    const infos = publicWalkInfos(SENIOR_WALK_ALIASES[session.walk] || session.walk);
    const li = document.createElement("li");
    li.className = "next-card senior-card";
    li.innerHTML = walkCardHtml({
      walk: session.walk,
      kind: infos?.kind || "Balade seniors · 1 h 15",
      summary: infos?.summary || "Au rythme paisible, avec des étapes de repos.",
      slot: session.slot,
      dates: [session.date],
      media: infos?.image ? walkMediaHtml(infos.image, infos.imageAlt, String(index + 1).padStart(2, "0"), formatPeriod([session.date])) : "",
      openable: false,
    });
    track.append(li);
  });
}

/** Carrousel familles : une carte par balade, avec toutes ses dates à venir. */
function buildFamilyTrack(track) {
  const parBalade = new Map();
  extraSessions("familles").forEach((session) => {
    if (!parBalade.has(session.walk)) parBalade.set(session.walk, { slot: session.slot, dates: [] });
    parBalade.get(session.walk).dates.push(session.date);
  });
  track.replaceChildren();
  if (!parBalade.size) track.append(emptyCard("family-card"));
  parBalade.forEach(({ slot, dates }, walk) => {
    const li = document.createElement("li");
    li.className = "next-card family-card";
    li.innerHTML = walkCardHtml({
      walk,
      kind: "Balade familles · 1 h 15",
      summary: "Une balade contée et interactive, avec des énigmes pour petits et grands.",
      slot,
      dates,
      media: "",
      openable: false,
    });
    track.append(li);
  });
}

[
  ["#inspiration-track", "[data-inspiration-prev]", "[data-inspiration-next]", buildPublicTrack],
  ["#seniors-track", "[data-seniors-prev]", "[data-seniors-next]", buildSeniorTrack],
  ["#familles-track", "[data-familles-prev]", "[data-familles-next]", buildFamilyTrack],
].forEach(([trackSelector, prevSelector, nextSelector, build]) => {
  const track = document.querySelector(trackSelector);
  if (!track) return;
  build(track);
  setupCarousel(track, document.querySelector(prevSelector), document.querySelector(nextSelector));
});

// Repère de l’accueil : nombre de dates tout public encore à venir.
const datesOutput = document.querySelector("[data-count-dates]");
if (datesOutput && programCards.length) {
  datesOutput.textContent = String(programCards.reduce((total, card) => total + upcomingDates(card).length, 0));
}

const year = document.querySelector("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());

// Sur téléphone, la page derrière une fenêtre ouverte ne doit pas défiler :
// on fige le document tant qu’un dialogue est ouvert.
const pageDialogs = [...document.querySelectorAll("dialog.legal-dialog")];

function syncPageScrollLock() {
  const ouvert = pageDialogs.some((dialogue) => dialogue.open || dialogue.hasAttribute("open"));
  document.documentElement.classList.toggle("dialog-open", ouvert);
}

if (pageDialogs.length) {
  pageDialogs.forEach((dialogue) => {
    dialogue.addEventListener("close", syncPageScrollLock);
  });
  const observateur = new MutationObserver(syncPageScrollLock);
  pageDialogs.forEach((dialogue) => {
    observateur.observe(dialogue, { attributes: true, attributeFilter: ["open"] });
  });
  syncPageScrollLock();
}

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


// ------------------------------------------------------------------ Présentation d’une balade
const walkDialog = document.querySelector("#walk-dialog");
const walkDialogTitle = document.querySelector("#walk-dialog-title");
const walkDialogKicker = document.querySelector("#walk-dialog-kicker");
const walkDialogContent = document.querySelector("#walk-dialog-content");
const walkDialogFoot = document.querySelector("#walk-dialog-foot");
const walkDialogDates = document.querySelector("#walk-dialog-dates");
const walkArticles = walkDialog ? [...walkDialog.querySelectorAll("[data-walk-article]")] : [];
const walkFallbackArticle = walkDialog?.querySelector("[data-walk-fallback]");
const walkFallbackText = walkDialog?.querySelector("[data-walk-fallback-text]");
const walkMoreWrap = walkDialog?.querySelector("[data-walk-more-wrap]");
const walkMoreButton = walkDialog?.querySelector("[data-walk-more]");

/** Dates à venir de la balade, en simple information, sous la présentation. */
function renderWalkDialogDates(walkName) {
  if (!walkDialogDates || !walkDialogFoot) return;
  const card = programCards.find((item) => item.dataset.walk === walkName);
  const dates = card ? upcomingDates(card) : [];
  walkDialogDates.replaceChildren();
  dates.forEach((date) => {
    const etiquette = document.createElement("span");
    etiquette.className = "walk-dialog-date";
    etiquette.innerHTML = `<span>${escapeHtml(formatFrenchDate(date))}</span><small>${escapeHtml(formatSlot(card.dataset.slot))}</small>`;
    walkDialogDates.append(etiquette);
  });
  walkDialogDates.hidden = dates.length === 0;
  const label = walkDialogFoot.querySelector(".walk-dialog-foot-label");
  if (label) label.textContent = dates.length ? "Prochaines dates" : "Aucune date programmée pour le moment";
}
function updateWalkMoreControl() {
  const article = walkArticles.find((item) => !item.hidden);
  if (!walkMoreWrap || !walkMoreButton || !article) return;
  const ouvert = article.dataset.walkExpanded === "true";
  // Replié : le bouton n’apparaît que si le texte dépasse réellement la zone lisible.
  const deborde = article.scrollHeight > article.clientHeight + 6;
  walkMoreWrap.hidden = !ouvert && !deborde;
  walkMoreButton.setAttribute("aria-expanded", ouvert ? "true" : "false");
  walkMoreButton.innerHTML = ouvert
    ? 'Réduire la présentation <span aria-hidden="true">↑</span>'
    : 'Lire la suite <span aria-hidden="true">↓</span>';
}

function setWalkArticleExpanded(expanded) {
  const article = walkArticles.find((item) => !item.hidden);
  if (!article) return;
  article.dataset.walkExpanded = expanded ? "true" : "false";
  article.classList.toggle("is-collapsed", !expanded);
  if (walkDialogContent) walkDialogContent.scrollTop = 0;
  window.requestAnimationFrame(updateWalkMoreControl);
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
  // Chaque balade s’ouvre sur son accroche : la suite reste à portée d’un clic.
  setWalkArticleExpanded(false);
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

walkMoreButton?.addEventListener("click", () => {
  const article = walkArticles.find((item) => !item.hidden);
  setWalkArticleExpanded(article?.dataset.walkExpanded !== "true");
});

window.addEventListener("resize", () => {
  if (walkDialog?.open) updateWalkMoreControl();
});

document.addEventListener("click", (event) => {
  const trigger = event.target instanceof Element ? event.target.closest("[data-walk-open]") : null;
  if (!trigger) return;
  event.preventDefault();
  openWalkDialog(trigger.dataset.walkOpen);
});
