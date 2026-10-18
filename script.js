// Réservations publiques : API locale Python (/api) ou Web App Apps Script si BOOKING_API_URL est renseigné.
// les demandes sur mesure utilisent toujours le courriel.
const CONTACT_EMAIL = "balades.culturelles@gmail.com";
const PUBLIC_TOPIC = "Je souhaite réserver une balade publique";
const MAX_CAPACITY = 25;
// URL de la Web App Apps Script (…/exec), pour la version GitHub Pages. Laisser vide avec le serveur Python local.
const BOOKING_API_URL = "https://script.google.com/macros/s/AKfycbzo7ZZCjaeM2cOuqeLq08qfhwOBwKuCn2zWvHCXamJhlxy67ZM1or_glOYAkx32BKe4hA/exec";
const IS_LOCAL_PREVIEW = ["localhost", "127.0.0.1"].includes(window.location.hostname) || window.location.hostname.endsWith(".e2b.app");
const ACTIVE_API_URL = IS_LOCAL_PREVIEW ? "" : BOOKING_API_URL;
const AGE_GROUP_PRICES = Object.freeze({ standard: 15, youth: 12, child: 8, underFive: 0 });

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
const ageGroupsFieldset = document.querySelector("#age-groups");
const ageGroupInputs = [...document.querySelectorAll("[data-age-group]")];
const participantsTotalOutput = document.querySelector("#participants-total");
const bookingEstimateOutput = document.querySelector("#booking-estimate");
const ageGroupStatus = document.querySelector("#age-group-status");
const submitButton = document.querySelector("#submit-booking");
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

const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
if (dateInput) dateInput.min = localToday();

document.querySelectorAll("[data-program-date]").forEach((date) => {
  const isoDate = date.dataset.programDate || date.dateTime;
  if (isoDate && isoDate < localToday()) date.hidden = true;
});

const programCards = [...document.querySelectorAll("[data-program-card]")];
const programEmpty = document.querySelector("[data-program-empty]");
const programFilterEmpty = document.querySelector("#program-filter-empty");
const programSearchInput = document.querySelector("#program-search");
const programFilterButtons = [...document.querySelectorAll("[data-program-filter]")];
const availableFilterButton = document.querySelector('[data-program-filter="available"]');
const programResultCount = document.querySelector("#program-result-count");
const clearProgramFiltersButton = document.querySelector("#clear-program-filters");
let activeProgramFilter = "all";

programCards.forEach((card) => {
  const hasUpcoming = Boolean(card.querySelector("[data-program-date]:not([hidden])"));
  card.dataset.hasUpcoming = String(hasUpcoming);
  card.hidden = !hasUpcoming;
});
if (availableFilterButton) availableFilterButton.disabled = true;

// ------------------------------------------------------------------ Les prochaines balades, en carrousel
const inspirationTrack = document.querySelector("#inspiration-track");
const inspirationPrevButton = document.querySelector("[data-inspiration-prev]");
const inspirationNextButton = document.querySelector("[data-inspiration-next]");
const inspirationCards = [];

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

// Une carte par balade à venir, dans l’ordre chronologique, avec sa photo et son résumé.
function buildInspirationTrack() {
  if (!inspirationTrack) return;
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

  inspirationTrack.replaceChildren();
  inspirationCards.length = 0;

  baladesAVenir.forEach(({ card, liensDates }, index) => {
    const walk = card.dataset.walk || "";
    const slot = card.dataset.slot || "";
    const image = card.dataset.image || "";
    const imageAlt = card.dataset.imageAlt || walk;
    const summary = card.dataset.summary || "";
    const kind = card.querySelector(".program-kind")?.textContent?.trim() || "";
    const numero = String(index + 1).padStart(2, "0");
    const periode = formatWalkPeriod(liensDates);

    const carte = document.createElement("article");
    carte.className = "next-card";
    carte.setAttribute("role", "listitem");
    carte.dataset.walk = walk;

    const datesHtml = liensDates.map((lien, idx) => {
      const date = lien.dataset.programDate || "";
      const dateComplete = lien.dataset.fullDate || date;
      const jour = lien.querySelector(".program-date-day")?.textContent?.trim() || "";
      const weekday = lien.querySelector(".program-date-weekday")?.textContent?.trim() || "";
      const mois = lien.querySelector(".program-date-month")?.textContent?.trim() || "";
      return `
        <a class="next-card-date-pill" href="#contact" data-next-date-index="${idx}" data-interest="${escapeHtml(PUBLIC_TOPIC)}" data-walk="${escapeHtml(walk)}" data-date="${escapeHtml(date)}" data-slot="${escapeHtml(slot)}" aria-label="Réserver une place pour ${escapeHtml(walk)} le ${escapeHtml(dateComplete)}">
          <span class="next-card-date-chip"><b>${escapeHtml(jour)}</b> ${escapeHtml(weekday)} ${escapeHtml(mois)}</span>
          <span class="next-card-places" data-next-places>Chargement…</span>
        </a>`;
    }).join("");

    carte.innerHTML = `
      <div class="next-card-media">
        <img class="next-card-image" src="${escapeHtml(image)}" alt="${escapeHtml(imageAlt)}" loading="lazy">
        <span class="next-card-badge">${escapeHtml(numero)}</span>
        <span class="next-card-period">${escapeHtml(periode)}</span>
      </div>
      <div class="next-card-body">
        <span class="next-card-kind">${escapeHtml(kind)}</span>
        <h3 class="next-card-title"><button type="button" class="next-card-title-link" data-walk-open="${escapeHtml(walk)}">${escapeHtml(walk)}</button></h3>
        <p class="next-card-summary">${escapeHtml(summary)}</p>
        <div class="next-card-dates" aria-label="Prochaines dates pour ${escapeHtml(walk)}">${datesHtml}</div>
      </div>`;

    const pilules = [...carte.querySelectorAll(".next-card-date-pill")];
    const couplesDates = liensDates.map((lien, idx) => ({ lien, pilule: pilules[idx] }));
    inspirationTrack.append(carte);
    inspirationCards.push({ carte, couplesDates });
  });

  syncInspirationTrack();
  updateInspirationButtons();
}

// Les places restantes suivent celles du programme.
function syncInspirationTrack() {
  inspirationCards.forEach(({ carte, couplesDates }) => {
    couplesDates.forEach(({ lien, pilule }) => {
      if (!pilule) return;
      const source = lien.querySelector("[data-availability-label]");
      const cible = pilule.querySelector("[data-next-places]");
      if (source && cible) cible.textContent = source.textContent;
      const complet = lien.dataset.soldOut === "true";
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

function updateInspirationButtons() {
  if (!inspirationTrack) return;
  const max = inspirationTrack.scrollWidth - inspirationTrack.clientWidth - 2;
  if (inspirationPrevButton) inspirationPrevButton.disabled = inspirationTrack.scrollLeft <= 2;
  if (inspirationNextButton) inspirationNextButton.disabled = inspirationTrack.scrollLeft >= max;
}

function scrollInspiration(direction) {
  if (!inspirationTrack) return;
  const carte = inspirationTrack.querySelector(".next-card");
  if (!carte) return;
  const ecart = parseFloat(window.getComputedStyle(inspirationTrack).columnGap || "13") || 13;
  const pas = carte.getBoundingClientRect().width + ecart;
  inspirationTrack.scrollBy({ left: direction * pas, behavior: "smooth" });
}

buildInspirationTrack();
if (inspirationPrevButton) inspirationPrevButton.addEventListener("click", () => scrollInspiration(-1));
if (inspirationNextButton) inspirationNextButton.addEventListener("click", () => scrollInspiration(1));
if (inspirationTrack) inspirationTrack.addEventListener("scroll", updateInspirationButtons, { passive: true });
window.addEventListener("resize", updateInspirationButtons);

function isPublicBooking() {
  return topicSelect?.value === PUBLIC_TOPIC;
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
    participantsInput.max = String(MAX_CAPACITY);
  }
  if (ageGroupsFieldset) ageGroupsFieldset.hidden = !publicMode;
  ageGroupInputs.forEach((input) => {
    input.disabled = !publicMode;
    input.max = String(MAX_CAPACITY);
  });
  if (customParticipantsInput) {
    customParticipantsInput.disabled = publicMode;
    customParticipantsInput.max = "100";
  }
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
    if (!Number.isInteger(value) || value < 0 || value > MAX_CAPACITY) valid = false;
    ageGroups[input.dataset.ageGroup] = value;
  });
  return { ageGroups, valid };
}

function ageGroupTotal(ageGroups) {
  return Object.values(ageGroups).reduce((total, count) => total + count, 0);
}

function estimateFare(ageGroups) {
  return Object.entries(AGE_GROUP_PRICES).reduce((total, [group, price]) => total + ageGroups[group] * price, 0);
}

function updateAgeEstimate() {
  if (!ageGroupInputs.length) return;
  const { ageGroups, valid } = readAgeGroups();
  const total = ageGroupTotal(ageGroups);
  const amount = estimateFare(ageGroups);
  if (participantsInput) participantsInput.value = String(total);
  if (participantsTotalOutput) participantsTotalOutput.textContent = String(total);
  if (bookingEstimateOutput) bookingEstimateOutput.textContent = total > 0 ? `${amount} €` : "—";
  const selected = sessionsById.get(sessionSelect?.value || "");
  const maxForSession = selected ? Math.min(MAX_CAPACITY, selected.remaining) : MAX_CAPACITY;
  ageGroupInputs.forEach((input) => { input.max = String(maxForSession); });
  if (!ageGroupStatus) return;
  if (total === 0 && !ageGroupsTouched) {
    ageGroupStatus.classList.remove("is-error");
    ageGroupStatus.textContent = "Renseignez votre groupe pour afficher le total et l’estimation.";
    return;
  }
  ageGroupStatus.classList.toggle("is-error", !valid || total < 1 || total > MAX_CAPACITY || (selected && total > selected.remaining));
  if (!valid) {
    ageGroupStatus.textContent = "Saisissez un nombre entier supérieur ou égal à zéro dans chaque tranche.";
  } else if (total < 1) {
    ageGroupStatus.textContent = "Indiquez au moins une personne pour estimer le montant.";
  } else if (total > MAX_CAPACITY) {
    ageGroupStatus.textContent = `Une visite est limitée à ${MAX_CAPACITY} personnes au total.`;
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

  programCards.forEach((card) => {
    if (card.dataset.hasUpcoming !== "true") {
      card.hidden = true;
      return;
    }
    upcomingCount += 1;
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

  if (programEmpty) programEmpty.hidden = upcomingCount > 0;
  if (programFilterEmpty) programFilterEmpty.hidden = upcomingCount === 0 || visibleCount > 0;
  if (programResultCount) {
    if (upcomingCount === 0) {
      programResultCount.textContent = "Aucune date à venir.";
    } else if (activeProgramFilter === "available") {
      programResultCount.textContent = `${visibleCount} balade${visibleCount > 1 ? "s" : ""} · ${visibleDateCount} date${visibleDateCount > 1 ? "s" : ""} avec des places`;
    } else if (query) {
      programResultCount.textContent = `${visibleCount} résultat${visibleCount > 1 ? "s" : ""} pour « ${programSearchInput.value.trim()} »`;
    } else if (availabilityError) {
      programResultCount.textContent = `${visibleCount} balade${visibleCount > 1 ? "s" : ""} à venir · disponibilités momentanément indisponibles`;
    } else if (availabilityLoaded) {
      programResultCount.textContent = `${visibleCount} balade${visibleCount > 1 ? "s" : ""} · ${visibleDateCount} date${visibleDateCount > 1 ? "s" : ""} à venir`;
    } else {
      programResultCount.textContent = `${visibleCount} balade${visibleCount > 1 ? "s" : ""} à venir · chargement des places…`;
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

function findSessionForTarget(target) {
  if (!target?.walk) return null;
  const matches = availabilitySessions.filter((session) => {
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
  updateAgeEstimate();
}

function renderSessionOptions(preferredId = "") {
  if (!sessionSelect) return;
  const previousId = preferredId || sessionSelect.value;
  sessionSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = availabilitySessions.length ? "Choisissez une balade et une date" : "Aucune date à réserver pour le moment";
  sessionSelect.append(placeholder);

  availabilitySessions.forEach((session) => {
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
      const scheduled = availabilitySessions.some((session) => session.date === pendingSessionTarget.date && session.walk === pendingSessionTarget.walk);
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
    const available = session.remaining > 0;
    if (label) label.textContent = available ? `${session.remaining} place${session.remaining > 1 ? "s" : ""}` : "Complet";
    link.classList.toggle("is-sold-out", !available);
    link.classList.remove("is-unavailable");
    link.dataset.soldOut = String(!available);
    link.dataset.sessionId = session.id;
    link.setAttribute("aria-disabled", String(!available));
    if (!available) link.tabIndex = -1;
    else link.removeAttribute("tabindex");
    const dateLabel = link.dataset.fullDate || link.querySelector("time")?.textContent || date;
    link.setAttribute("aria-label", `${walk}, le ${dateLabel} : ${available ? `${pluralPlaces(session.remaining)} restantes sur ${session.capacity}` : "complet"}.`);
  });

  programCards.forEach((card) => {
    const dates = [...card.querySelectorAll("[data-program-date]:not([hidden])")];
    const allFull = dates.length > 0 && dates.every((link) => link.dataset.soldOut === "true");
    const cta = card.querySelector(".program-cta");
    if (cta) {
      cta.dataset.allSoldOut = String(allFull);
      cta.setAttribute("aria-disabled", String(allFull));
      if (allFull) cta.tabIndex = -1;
      else cta.removeAttribute("tabindex");
      if (cta.firstChild?.nodeType === Node.TEXT_NODE) {
        cta.firstChild.textContent = allFull ? "Toutes les dates sont complètes " : "Réserver une place ";
      }
    }
  });
  if (availableFilterButton) availableFilterButton.disabled = !availabilityLoaded;
  applyProgramFilters();
  syncInspirationTrack();
}

function renderAvailability(payload) {
  availabilitySessions = (payload.sessions || []).filter((session) => session.date >= localToday());
  sessionsById.clear();
  availabilitySessions.forEach((session) => sessionsById.set(session.id, session));
  availabilityLoaded = true;
  availabilityError = false;
  updateProgramAvailability();
  renderSessionOptions();
}

async function loadAvailability() {
  if (availabilityRequest) return availabilityRequest;
  availabilityRequest = (async () => {
    try {
      const response = await fetch(ACTIVE_API_URL ? `${ACTIVE_API_URL}?api=availability` : "/api/availability", { cache: "no-store", headers: { Accept: "application/json" } });
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
}

if (messageInput) {
  messageInput.addEventListener("input", () => {
    messageInput.dataset.prefilled = "false";
  });
}

// Les liens du programme remplissent automatiquement la séance; les liens sur mesure gardent le parcours e-mail.
document.querySelectorAll("[data-interest]").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (link.dataset.soldOut === "true" || link.dataset.allSoldOut === "true") {
      event.preventDefault();
      updateFormStatus("Cette visite est complète. Choisissez une autre date pour réserver.", "error");
      return;
    }
    updateFormStatus("");
    if (topicSelect) {
      topicSelect.value = link.dataset.interest;
      updateBookingMode();
    }

    const programCard = link.closest("[data-program-card]");
    const walkName = link.dataset.walk || programCard?.dataset.walk;
    if (!walkName) return;

    if (messageInput && (!messageInput.value.trim() || messageInput.dataset.prefilled === "true")) {
      messageInput.value = `Balade souhaitée : ${walkName}`;
      messageInput.dataset.prefilled = "true";
    }

    if (link.dataset.interest === PUBLIC_TOPIC) {
      const selectedDate = link.dataset.date || link.dataset.programDate || "";
      const slot = link.dataset.slot || programCard?.dataset.slot || "";
      chooseSession({ date: selectedDate, walk: walkName, slot });
    } else {
      const selectedDate = link.dataset.date || link.dataset.programDate || "";
      if (dateInput && selectedDate) dateInput.value = selectedDate;
      if (slotSelect) slotSelect.value = link.dataset.slot || programCard?.dataset.slot || "À convenir";
    }

    window.setTimeout(() => {
      const nextField = link.dataset.interest === PUBLIC_TOPIC ? sessionSelect : dateInput;
      nextField?.focus({ preventScroll: true });
    }, 0);
  });
});

function getSelectedSession() {
  return sessionsById.get(sessionSelect?.value || "") || null;
}

function updateFormStatus(message, state = "info") {
  if (!formStatus) return;
  formStatus.textContent = message;
  if (message) formStatus.dataset.state = state;
  else delete formStatus.dataset.state;
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
  if (!ageGroupsValid || participants < 1 || participants > MAX_CAPACITY) {
    updateFormStatus(`Répartissez les participants par tarif; une visite est limitée à ${MAX_CAPACITY} personnes au total.`, "error");
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

  if (submitButton) submitButton.disabled = true;
  updateFormStatus("Enregistrement de votre réservation…", "pending");
  try {
    // Apps Script : text/plain évite le pré-vol CORS ; la réponse reste lisible en JSON.
    const response = await fetch(ACTIVE_API_URL || "/api/bookings", {
      method: "POST",
      headers: ACTIVE_API_URL
        ? { "Content-Type": "text/plain;charset=utf-8" }
        : { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        session_id: session.id, first_name: firstName, last_name: lastName,
        email, phone, message, participants, age_groups: ageGroups,
      }),
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      updateFormStatus(result.message || "La réservation n’a pas pu être confirmée. Vérifiez les places disponibles et réessayez.", "error");
      await loadAvailability();
      return;
    }
    updateFormStatus(`Réservation confirmée pour ${result.walk}, le ${formatFrenchDate(result.date)} à ${result.slot} (${result.participants} personne${result.participants > 1 ? "s" : ""}, estimation ${result.price_estimate} €). Référence : ${result.reference}. Il reste ${result.remaining} place${result.remaining > 1 ? "s" : ""}. Un e-mail de confirmation vient de vous être envoyé : conservez votre référence, elle suffit pour annuler ou modifier.`, "success");
    if (sessionSelect) sessionSelect.value = "";
    ageGroupInputs.forEach((input) => { input.value = "0"; });
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
  if (participants && (!/^\d+$/.test(participants) || Number(participants) < 1 || Number(participants) > 100)) {
    updateFormStatus("Indiquez un nombre de personnes compris entre 1 et 100.", "error");
    customParticipantsInput?.focus();
    return;
  }
  if (!email) return;

  if (submitButton) submitButton.disabled = true;
  updateFormStatus("Envoi de votre demande…", "pending");
  try {
    const response = await fetch(ACTIVE_API_URL || "/api/bookings", {
      method: "POST",
      headers: ACTIVE_API_URL
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
loadAvailability();
// Google Apps Script : interrogé moins souvent pour rester dans les quotas gratuits.
window.setInterval(loadAvailability, ACTIVE_API_URL ? 120_000 : 30_000);
window.addEventListener("focus", loadAvailability);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadAvailability();
});

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
    else legalDialog.setAttribute("open", "");
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
    const places = lien.querySelector("[data-availability-label]")?.textContent?.trim() || "Places disponibles";
    const complet = lien.dataset.soldOut === "true";

    const boutonDate = document.createElement("a");
    boutonDate.className = `walk-dialog-date-btn${complet ? " is-sold-out" : ""}`;
    boutonDate.href = "#contact";
    boutonDate.dataset.soldOut = complet ? "true" : "";
    boutonDate.setAttribute("aria-disabled", String(complet));
    boutonDate.innerHTML = `<span>Réserver le ${escapeHtml(weekday)} ${escapeHtml(dateComplete)}</span><small>${escapeHtml(places)}</small>`;
    boutonDate.addEventListener("click", (event) => {
      if (complet) {
        event.preventDefault();
        return;
      }
      closeWalkDialog();
      updateFormStatus("");
      if (topicSelect) {
        topicSelect.value = PUBLIC_TOPIC;
        updateBookingMode();
      }
      if (messageInput && (!messageInput.value.trim() || messageInput.dataset.prefilled === "true")) {
        messageInput.value = `Balade souhaitée : ${walkName}`;
        messageInput.dataset.prefilled = "true";
      }
      chooseSession({ date, walk: walkName, slot });
    });
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
    else walkDialog.setAttribute("open", "");
  }
  if (walkDialogContent) walkDialogContent.scrollTop = 0;
  walkDialog.querySelector("[data-walk-close]")?.focus();
}

function closeWalkDialog() {
  if (!walkDialog?.open) return;
  if (typeof walkDialog.close === "function") walkDialog.close();
  else {
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

