// Réservations publiques : API locale Python (/api) ou Web App Apps Script si BOOKING_API_URL est renseigné.
// les demandes sur mesure utilisent toujours le courriel.
const CONTACT_EMAIL = "balades.culturelles@gmail.com";
const PUBLIC_TOPIC = "Je souhaite réserver une balade publique";
const MAX_CAPACITY = 20;
// URL de la Web App Apps Script (…/exec), pour la version GitHub Pages. Laisser vide avec le serveur Python local.
const BOOKING_API_URL = "";
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
    customParticipantsInput.max = String(MAX_CAPACITY);
  }
  if (submitButton) {
    const label = publicMode ? "Réserver ma place" : "Préparer ma demande";
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
    const dateLabel = link.querySelector("time")?.textContent || date;
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
      const response = await fetch(BOOKING_API_URL ? `${BOOKING_API_URL}?api=availability` : "/api/availability", { cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
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

  const name = String(values.get("name") || "").trim();
  const email = String(values.get("email") || "").trim();
  if (!name || !email) return;

  if (submitButton) submitButton.disabled = true;
  updateFormStatus("Enregistrement de votre réservation…", "pending");
  try {
    // Apps Script : text/plain évite le pré-vol CORS ; la réponse reste lisible en JSON.
    const response = await fetch(BOOKING_API_URL || "/api/bookings", {
      method: "POST",
      headers: BOOKING_API_URL
        ? { "Content-Type": "text/plain;charset=utf-8" }
        : { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ session_id: session.id, name, email, participants, age_groups: ageGroups }),
    });
    const result = await response.json();
    if (!response.ok || result.error) {
      updateFormStatus(result.message || "La réservation n’a pas pu être confirmée. Vérifiez les places disponibles et réessayez.", "error");
      await loadAvailability();
      return;
    }
    updateFormStatus(`Réservation confirmée pour ${result.walk}, le ${formatFrenchDate(result.date)} à ${result.slot} (${result.participants} personne${result.participants > 1 ? "s" : ""}, estimation ${result.price_estimate} €). Référence : ${result.reference}. Il reste ${result.remaining} place${result.remaining > 1 ? "s" : ""}. Aucun e-mail automatique n’est envoyé : conservez cette référence.`, "success");
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

function submitCustomRequest(values) {
  if (!CONTACT_EMAIL) {
    updateFormStatus("Le formulaire est prêt, mais son envoi n’est pas configuré. Renseignez l’adresse de réception dans script.js avant la mise en ligne.", "error");
    return;
  }
  const name = String(values.get("name") || "").trim();
  const email = String(values.get("email") || "").trim();
  const topic = String(values.get("topic") || "").trim();
  const date = String(values.get("date") || "").trim();
  const participants = String(values.get("custom_participants") || "").trim();
  const slot = String(values.get("slot") || "").trim();
  const message = String(values.get("message") || "").trim();
  if (participants && (!/^\d+$/.test(participants) || Number(participants) < 1 || Number(participants) > MAX_CAPACITY)) {
    updateFormStatus(`Une visite est limitée à ${MAX_CAPACITY} personnes. Indiquez un nombre inférieur ou égal, ou contactez Marie-Tiyi.`, "error");
    customParticipantsInput?.focus();
    return;
  }
  const subject = encodeURIComponent(`Balades Culturelles — ${topic}`);
  const body = encodeURIComponent([
    "Bonjour Marie-Tiyi,",
    "",
    `Je m’appelle ${name}.`,
    `Mon adresse e-mail : ${email}`,
    `Mon projet : ${topic}`,
    date ? `Date souhaitée : ${date}` : "",
    slot && slot !== "À convenir" ? `Créneau souhaité : ${slot}` : "",
    participants ? `Nombre de personnes : ${participants}` : "",
    "",
    message || "Je souhaite échanger au sujet d’une balade culturelle.",
  ].filter(Boolean).join("\n"));
  updateFormStatus("Votre logiciel de messagerie va s’ouvrir avec votre demande préremplie.");
  window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
}

if (contactForm && formStatus) {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isPublicBooking()) {
      await submitPublicBooking(new FormData(contactForm));
      return;
    }
    if (!contactForm.reportValidity()) return;
    submitCustomRequest(new FormData(contactForm));
  });
}

applyProgramFilters();
updateBookingMode();
loadAvailability();
window.setInterval(loadAvailability, 30_000);
window.addEventListener("focus", loadAvailability);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadAvailability();
});

const year = document.querySelector("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());

function openLegalPanelFromHash() {
  const hash = window.location.hash;
  if (!hash) return;
  const panel = document.getElementById(hash.slice(1));
  if (panel?.tagName === "DETAILS") panel.open = true;
}
document.querySelectorAll('a[href="#mentions-legales"], a[href="#confidentialite"]').forEach((link) => {
  link.addEventListener("click", () => window.setTimeout(openLegalPanelFromHash, 0));
});
window.addEventListener("hashchange", openLegalPanelFromHash);
openLegalPanelFromHash();
