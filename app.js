import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const isConfigured = SUPABASE_URL && !SUPABASE_URL.includes("YOUR_PROJECT_REF")
  && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY");

const supabase = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let selectedDate = new Date();
let currentUser = null;
let currentProfile = null;
let allVisibleProfiles = [];
let allVisibleCustomItems = [];
let currentEntry = emptyEntry();
let weekEntries = [];
let adminRecapRows = [];
let adminRecapRange = null;
let saveTimer = null;
let recapChannel = null;

const $ = (id) => document.getElementById(id);

function emptyEntry() {
  return { notes: "", custom_checks: {} };
}

const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const sevenDaysAgoKey = () => {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return dateKey(d);
};

adminRecapRange = {
  period: "week",
  from: sevenDaysAgoKey(),
  to: dateKey(new Date()),
};

function parseDateKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDaysToKey(key, amount) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function inclusiveDayCount(from, to) {
  const fromDate = parseDateKey(from);
  const toDate = parseDateKey(to);
  const milliseconds = Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate())
    - Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  return Math.max(1, Math.floor(milliseconds / 86400000) + 1);
}

function formatRangeLabel(from, to) {
  if (from === to) return from;
  return `${from} s/d ${to}`;
}

function setSaveStatus(text) {
  const el = $("saveStatus");
  if (el) el.textContent = text;
}

function setAuthMessage(text, type = "") {
  const el = $("authMessage");
  if (!el) return;
  el.textContent = text || "";
  el.className = `auth-message ${type}`.trim();
}

function setCreateMessage(text, type = "") {
  const el = $("createAccountMessage");
  if (!el) return;
  el.textContent = text || "";
  el.className = `auth-message ${type}`.trim();
}

function setCustomItemMessage(text, type = "") {
  const el = $("customItemMessage");
  if (!el) return;
  el.textContent = text || "";
  el.className = `auth-message ${type}`.trim();
}

function roleLabel(role) {
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "User";
}

function normalizeEntry(data) {
  if (!data) return emptyEntry();
  return {
    notes: data.notes || "",
    custom_checks: (data.custom_checks && typeof data.custom_checks === "object" && !Array.isArray(data.custom_checks))
      ? data.custom_checks
      : {},
  };
}

function normalizeEntryWithDate(data) {
  const e = normalizeEntry(data);
  e.entry_date = data.entry_date;
  if (data.user_id) e.user_id = data.user_id;
  return e;
}

function customItemValue(entry, itemId) {
  return entry?.custom_checks?.[String(itemId)] ?? "";
}

function isCustomItemDone(entry, item) {
  const value = customItemValue(entry, item.id);
  if (item.input_type === "check") return value === true;
  if (typeof value === "number") {
    return item.legacy_key ? value > 0 : Number.isFinite(value);
  }
  return typeof value === "string" && value.trim() !== "";
}

function setCustomItemValue(entry, itemId, value) {
  if (!entry.custom_checks || typeof entry.custom_checks !== "object") entry.custom_checks = {};
  entry.custom_checks[String(itemId)] = value;
}

function applicableItemsForProfile(profile) {
  if (!profile) return [];
  if (profile.role === "user") {
    return allVisibleCustomItems.filter((i) => i.is_active && !i.is_deleted && (
      i.creator_role === "super_admin" ||
      (i.creator_role === "admin" && String(i.created_by) === String(profile.created_by))
    ));
  }
  if (profile.role === "admin") {
    return allVisibleCustomItems.filter((i) => i.is_active && !i.is_deleted && i.creator_role === "super_admin");
  }
  if (profile.role === "super_admin") {
    return allVisibleCustomItems.filter((i) => i.is_active && !i.is_deleted && i.creator_role === "super_admin");
  }
  return [];
}

function applicableItemsForSelf() {
  return applicableItemsForProfile(currentProfile);
}

function manageableItems() {
  if (!currentProfile) return [];
  if (currentProfile.role === "super_admin") return allVisibleCustomItems;
  if (currentProfile.role === "admin") return allVisibleCustomItems.filter((i) => String(i.created_by) === String(currentUser.id));
  return [];
}

function completedCountForProfile(entry, profile) {
  const items = applicableItemsForProfile(profile);
  return items.filter((i) => isCustomItemDone(entry, i)).length;
}

function totalTargetsForProfile(profile) {
  return applicableItemsForProfile(profile).length;
}

function completedCountForSelf(entry) {
  const items = applicableItemsForSelf();
  return items.filter((i) => isCustomItemDone(entry, i)).length;
}

function totalTargetsForSelf() {
  return applicableItemsForSelf().length;
}

function showView(loggedIn) {
  $("authSection").hidden = loggedIn;
  $("appSection").hidden = !loggedIn;
  $("appActions").hidden = !loggedIn;
  $("userArea").hidden = !loggedIn;
}

function updateRoleSections() {
  const role = currentProfile?.role || "user";
  const isAdmin = role === "admin";
  const isSuper = role === "super_admin";
  $("adminSection").hidden = !(isAdmin || isSuper);
  $("createAccountSection").hidden = !(isAdmin || isSuper);
  $("customItemsSection").hidden = !(isAdmin || isSuper);
  $("credentialManagementSection").hidden = !(isAdmin || isSuper);
  $("superAdminSection").hidden = !isSuper;

  if (isAdmin) {
    $("adminRecapTitle").textContent = `Rekap user di bawah saya (${formatRangeLabel(adminRecapRange.from, adminRecapRange.to)})`;
    $("adminHint").textContent = "Menampilkan rekap mutabaah user yang Anda kelola (di bawah Anda), termasuk item isian yang berlaku.";
    $("createAccountHint").textContent = "Buat akun baru untuk user. Akun akan berada di bawah pengelolaan Anda.";
    $("credentialManagementHint").textContent = "Ubah ID login/kata sandi atau hapus user yang Anda kelola. Penghapusan akun menghapus seluruh data mutabaah user tersebut.";
    $("customItemsHint").textContent = "Buat dan kelola item isian untuk user di bawah otorisasi Anda. Pilih jenis input; item aktif muncul di formulir mutabaah mereka.";
    $("newUserRoleField").hidden = true;
    $("newUserRole").value = "user";
  } else if (isSuper) {
    $("adminRecapTitle").textContent = `Rekap semua user (${formatRangeLabel(adminRecapRange.from, adminRecapRange.to)})`;
    $("adminHint").textContent = "Menampilkan rekap semua user (di bawah admin dan super admin), termasuk item isian yang berlaku.";
    $("createAccountHint").textContent = "Buat akun baru untuk admin atau user.";
    $("credentialManagementHint").textContent = "Ubah ID login/kata sandi, hapus akun user/admin, atau pindahkan user ke admin lain. Penghapusan akun menghapus data mutabaah terkait; pemindahan mempertahankan seluruh riwayat mutabaah.";
    $("customItemsHint").textContent = "Buat dan kelola item isian untuk semua user. Pilih jenis input; item aktif muncul di formulir mutabaah mereka.";
    $("newUserRoleField").hidden = false;
  }
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, login_id, email, full_name, role, created_by")
    .eq("id", currentUser.id)
    .single();
  if (error) throw error;
  currentProfile = data;
}

async function loadCustomItems() {
  const { data, error } = await supabase
    .from("custom_items")
    .select("id, label, input_type, created_by, creator_role, is_active, is_deleted, legacy_key, created_at")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    console.error(error);
    allVisibleCustomItems = [];
    return;
  }
  allVisibleCustomItems = data || [];
}

async function loadEntry() {
  const { data, error } = await supabase
    .from("mutabaah_entries")
    .select("entry_date, notes, custom_checks")
    .eq("user_id", currentUser.id)
    .eq("entry_date", dateKey(selectedDate))
    .maybeSingle();
  if (error) throw error;
  currentEntry = normalizeEntry(data);
}

async function loadWeekEntries() {
  const { data, error } = await supabase
    .from("mutabaah_entries")
    .select("entry_date, notes, custom_checks")
    .eq("user_id", currentUser.id)
    .gte("entry_date", sevenDaysAgoKey())
    .lte("entry_date", dateKey(new Date()));
  if (error) throw error;
  weekEntries = (data || []).map(normalizeEntryWithDate);
}

async function saveEntry() {
  if (!currentUser) return;
  setSaveStatus("Menyimpan...");
  const payload = {
    user_id: currentUser.id,
    entry_date: dateKey(selectedDate),
    notes: currentEntry.notes || "",
    custom_checks: currentEntry.custom_checks || {},
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("mutabaah_entries")
    .upsert(payload, { onConflict: "user_id,entry_date" });
  if (error) {
    setSaveStatus("Gagal menyimpan");
    console.error(error);
    return;
  }
  setSaveStatus("Tersimpan");
  await loadWeekEntries();
  renderSummary();
  if (currentProfile?.role !== "user") renderAdminPanels();
  recapChannel?.postMessage({ type: "entry-updated", userId: currentUser.id });
}

function scheduleSave(immediate = false) {
  if (saveTimer) clearTimeout(saveTimer);
  if (immediate) {
    saveEntry();
    return;
  }
  setSaveStatus("Mengetik...");
  saveTimer = setTimeout(() => saveEntry(), 500);
}

function updateProgressDisplay() {
  const completed = completedCountForSelf(currentEntry);
  const totalTargets = totalTargetsForSelf();
  const percentage = totalTargets ? Math.round((completed / totalTargets) * 100) : 0;

  $("completedCount").textContent = completed;
  $("totalCount").textContent = totalTargets;
  $("taskCount").textContent = `${totalTargets} target`;
  $("progressPercent").textContent = `${percentage}%`;
  $("progressBar").style.width = `${percentage}%`;
  $("encouragement").textContent = percentage === 100 && totalTargets > 0
    ? "Masya Allah, semua target hari ini selesai!"
    : percentage >= 50 ? "Teruskan, sedikit lagi menuju selesai."
      : "Awali dengan satu kebaikan kecil.";
}

function render() {
  if (!currentUser) return;
  const todayKey = dateKey(new Date());
  const isToday = dateKey(selectedDate) === todayKey;
  const applicable = applicableItemsForSelf();

  $("dayName").textContent = isToday
    ? "Hari ini"
    : selectedDate.toLocaleDateString("id-ID", { weekday: "long" });
  $("dateLabel").textContent = selectedDate.toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  });
  $("notes").value = currentEntry.notes || "";
  updateProgressDisplay();

  const dailyItems = $("dailyItems");
  const nodes = [];

  applicable.forEach((item) => {
    if (item.input_type === "check") {
      nodes.push(createCheckItem({
        label: item.label,
        category: "Item isian",
        checked: isCustomItemDone(currentEntry, item),
        onChange: (checked) => {
          setCustomItemValue(currentEntry, item.id, checked);
          render();
          scheduleSave(true);
        },
      }));
    } else {
      nodes.push(createCustomValueItem({
        item,
        value: customItemValue(currentEntry, item.id),
        onChange: (value) => {
          setCustomItemValue(currentEntry, item.id, value);
          updateProgressDisplay();
          scheduleSave(false);
        },
      }));
    }
  });

  if (nodes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Belum ada item amalan aktif untuk saat ini.";
    nodes.push(empty);
  }

  dailyItems.replaceChildren(...nodes);
  renderSummary();
}

function createCheckItem({ label, category, checked, onChange }) {
  const el = document.createElement("label");
  el.className = "task-item";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  const checkmark = document.createElement("span");
  checkmark.className = "checkmark";
  const text = document.createElement("span");
  text.className = "task-text";
  text.textContent = label;
  const cat = document.createElement("span");
  cat.className = "task-category";
  cat.textContent = category;
  el.append(input, checkmark, text, cat);
  return el;
}

function createCustomValueItem({ item, value, onChange }) {
  const label = document.createElement("label");
  label.className = "input-card custom-value-card";
  const icon = document.createElement("span");
  icon.className = "input-icon";
  icon.textContent = item.input_type === "number" ? "#" : "✎";
  const content = document.createElement("span");
  content.className = "input-content";
  const strong = document.createElement("strong");
  strong.textContent = item.label;
  const small = document.createElement("small");
  small.textContent = item.input_type === "number" ? "Isi angka" : "Isi manual";
  content.append(strong, small);
  const input = document.createElement("input");
  input.className = "custom-value-input";
  input.type = item.input_type === "number" ? "number" : "text";
  if (item.input_type === "number") {
    input.min = "0";
    input.step = "1";
  }
  input.value = value === "" || value == null ? "" : String(value);
  input.setAttribute("aria-label", item.label);
  input.addEventListener("input", () => {
    if (item.input_type === "number") {
      onChange(input.value === "" ? "" : Number(input.value));
    } else {
      onChange(input.value);
    }
  });
  label.append(icon, content, input);
  return label;
}

function renderSummary() {
  const days = [];
  const cursor = new Date();
  const applicable = applicableItemsForSelf();
  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - index);
    const key = dateKey(date);
    const found = weekEntries.find((e) => e.entry_date === key);
    days.push({ date, data: found || emptyEntry() });
  }

  const totalTargetsPerDay = totalTargetsForSelf();
  const completedTargets = days.reduce((sum, day) => sum + completedCountForSelf(day.data), 0);
  const denom = days.length * (totalTargetsPerDay || 0);
  const targetPercentage = denom ? Math.round((completedTargets / denom) * 100) : 0;

  renderSummaryStats(days, targetPercentage);

  const dayLabel = (date) => date.toLocaleDateString("id-ID", { weekday: "short" }).replace(".", "");
  const charts = $("summaryCharts");
  const chartNodes = [];

  const numericItems = applicable.filter((item) => item.input_type === "number");
  numericItems.forEach((item, index) => {
    const values = days.map((day) => {
      const value = customItemValue(day.data, item.id);
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    });
    const max = Math.max(1, ...values);
    chartNodes.push(createBarChart({
      title: item.label,
      subtitle: "jumlah per hari",
      max,
      unit: "jumlah",
      tone: index % 2 === 0 ? "teal" : "gold",
      days: days.map((day, dayIndex) => ({
        label: dayLabel(day.date),
        value: values[dayIndex],
        display: String(values[dayIndex]),
      })),
    }));
  });

  const statusRows = applicable.filter((item) => item.input_type !== "number").map((item) => ({
    label: item.label,
    days: days.map((day) => ({ label: dayLabel(day.date), done: isCustomItemDone(day.data, item) })),
  }));

  if (statusRows.length) {
    chartNodes.push(createStatusChart({
      title: "Status harian",
      subtitle: "status per hari",
      rows: statusRows,
    }));
  }

  if (!chartNodes.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Belum ada item aktif untuk ditampilkan pada ringkasan.";
    chartNodes.push(empty);
  }

  charts.replaceChildren(...chartNodes);
}

function renderSummaryStats(days, targetPercentage) {
  const wrap = $("summaryStats");
  if (!wrap) return;
  const applicable = applicableItemsForSelf();
  const nodes = [];

  applicable.filter((item) => item.input_type === "number").forEach((item) => {
    const total = days.reduce((sum, day) => {
      const value = customItemValue(day.data, item.id);
      return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0);
    const label = item.legacy_key === "quran_pages" ? "halaman" : "jumlah";
    nodes.push(createStatBox(String(total), `${item.label} · ${label}`));
  });

  nodes.push(createStatBox(`${targetPercentage}%`, "target tercapai"));

  if (nodes.length === 1) {
    // only target box, still fine
  }
  wrap.replaceChildren(...nodes);
}

function createStatBox(value, label) {
  const div = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = value;
  const span = document.createElement("span");
  span.textContent = label;
  div.append(strong, span);
  return div;
}

function createBarChart({ title, subtitle, max, unit, tone, days }) {
  const block = document.createElement("section");
  block.className = `chart-block chart-${tone}`;

  const header = document.createElement("div");
  header.className = "chart-header";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const hint = document.createElement("span");
  hint.textContent = subtitle;
  header.append(heading, hint);

  const chart = document.createElement("div");
  chart.className = "bar-chart";
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", `${title} tujuh hari terakhir`);

  days.forEach((day) => {
    const col = document.createElement("div");
    col.className = "bar-col";

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = day.display;

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("span");
    fill.className = "bar-fill";
    const height = max > 0 ? (day.value / max) * 100 : 0;
    fill.style.height = `${height}%`;
    track.title = `${day.label}: ${day.display} ${unit}`;
    track.append(fill);

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = day.label;

    col.append(value, track, label);
    chart.append(col);
  });

  block.append(header, chart);
  return block;
}

function createStatusChart({ title, subtitle, rows }) {
  const block = document.createElement("section");
  block.className = "chart-block chart-status";

  const header = document.createElement("div");
  header.className = "chart-header";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const hint = document.createElement("span");
  hint.textContent = subtitle;
  header.append(heading, hint);

  const table = document.createElement("div");
  table.className = "status-chart";

  const dayHeader = document.createElement("div");
  dayHeader.className = "status-row status-head";
  const corner = document.createElement("span");
  corner.className = "status-corner";
  dayHeader.append(corner);
  (rows[0]?.days || []).forEach((day) => {
    const label = document.createElement("span");
    label.className = "status-day-label";
    label.textContent = day.label;
    dayHeader.append(label);
  });
  table.append(dayHeader);

  rows.forEach((row) => {
    const line = document.createElement("div");
    line.className = "status-row";
    const name = document.createElement("span");
    name.className = "status-name";
    name.textContent = row.label;
    name.title = row.label;
    line.append(name);

    row.days.forEach((day) => {
      const dot = document.createElement("span");
      dot.className = `status-dot ${day.done ? "is-done" : ""}`;
      dot.title = `${row.label} ${day.label}: ${day.done ? "Selesai" : "Belum"}`;
      dot.setAttribute("aria-label", `${row.label} ${day.label} ${day.done ? "selesai" : "belum"}`);
      dot.textContent = day.done ? "✓" : "";
      line.append(dot);
    });
    table.append(line);
  });

  block.append(header, table);
  return block;
}

function groupEntriesByUser(entries) {
  const byUser = new Map();
  entries.forEach((e) => {
    const key = String(e.user_id);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(e);
  });
  return byUser;
}

async function renderAdminPanels() {
  if (!currentProfile || currentProfile.role === "user") return;
  const from = adminRecapRange.from;
  const to = adminRecapRange.to;

  const profilesRes = await supabase
    .from("profiles")
    .select("id, login_id, email, full_name, role, created_by, created_at")
    .order("created_at", { ascending: true });

  if (profilesRes.error) {
    $("adminUsersSummary").textContent = "Gagal memuat data.";
    console.error(profilesRes.error);
    return;
  }

  allVisibleProfiles = profilesRes.data || [];
  let scopedUsers;
  if (currentProfile.role === "admin") {
    scopedUsers = allVisibleProfiles.filter((p) => String(p.created_by) === String(currentUser.id) && p.role === "user");
  } else {
    scopedUsers = allVisibleProfiles.filter((p) => p.role === "user");
  }

  let entries = [];
  if (scopedUsers.length) {
    const entriesRes = await supabase
      .from("mutabaah_entries")
      .select("user_id, entry_date, custom_checks")
      .in("user_id", scopedUsers.map((p) => p.id))
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: false });

    if (entriesRes.error) {
      $("adminUsersSummary").textContent = "Gagal memuat data rekap mutabaah.";
      console.error(entriesRes.error);
      return;
    }
    entries = entriesRes.data || [];
  }

  const normalizedEntries = entries.map(normalizeEntryWithDate);
  const byUser = groupEntriesByUser(normalizedEntries);

  renderAdminSummary(scopedUsers, byUser);
  renderCustomItemsManager();
  renderCredentialManagement(allVisibleProfiles);
  if (currentProfile.role === "super_admin") renderRoleManagement(allVisibleProfiles);
}

function renderAdminSummary(users, byUser) {
  const wrap = $("adminUsersSummary");
  adminRecapRows = [];
  const showManager = currentProfile.role === "super_admin";
  const dayCount = inclusiveDayCount(adminRecapRange.from, adminRecapRange.to);
  const rangeLabel = formatRangeLabel(adminRecapRange.from, adminRecapRange.to);
  const periodLabel = `(${rangeLabel})`;
  const title = $("adminRecapTitle");
  title.textContent = currentProfile.role === "admin"
    ? `Rekap user di bawah saya ${periodLabel}`
    : `Rekap semua user ${periodLabel}`;
  const items = [];
  const itemMap = new Map();
  users.forEach((profile) => {
    applicableItemsForProfile(profile).forEach((item) => {
      const key = String(item.id);
      if (!itemMap.has(key)) {
        itemMap.set(key, item);
        items.push(item);
      }
    });
  });

  if (!users.length) {
    wrap.textContent = "Belum ada user pada cakupan ini.";
    return;
  }

  const profileMap = new Map(allVisibleProfiles.map((p) => [String(p.id), p]));
  const table = document.createElement("table");
  table.className = "admin-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.append(th("Pengguna"));
  if (showManager) headRow.append(th("Dikelola oleh"));
  items.forEach((item) => headRow.append(th(`${item.label} (${dayCount} hari)`)));
  headRow.append(th(`Target (${dayCount} hari)`));
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");

  users.forEach((p) => {
    const list = byUser.get(String(p.id)) || [];
    const perDay = totalTargetsForProfile(p);
    const done = list.reduce((s, e) => s + completedCountForProfile(e, p), 0);
    const denom = dayCount * perDay;
    const pct = denom ? Math.round((done / denom) * 100) : 0;
    const manager = p.created_by ? profileMap.get(String(p.created_by)) : null;
    const managerLabel = manager
      ? `${manager.full_name || manager.email || "-"} (${roleLabel(manager.role)})`
      : "-";

    const recap = {
      name: p.full_name || p.login_id || "-",
      email: p.email || "",
      manager: managerLabel,
      custom: {},
      done,
      denom,
      pct,
    };

    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.innerHTML = `<strong>${escapeHtml(p.full_name || p.login_id || "-")}</strong><small>ID: ${escapeHtml(p.login_id)}${p.email ? ` · ${escapeHtml(p.email)}` : ""}</small>`;
    tr.append(nameTd);
    if (showManager) tr.append(cell(managerLabel));

    const applicable = applicableItemsForProfile(p);
    const applicableIds = new Set(applicable.map((item) => String(item.id)));
    items.forEach((item) => {
      const key = String(item.id);
      if (!applicableIds.has(key)) {
        recap.custom[key] = "-";
        tr.append(cell("-"));
        return;
      }
      let display;
      if (item.input_type === "number") {
        const total = list.reduce((sum, entry) => {
          const value = customItemValue(entry, item.id);
          return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
        }, 0);
        display = String(total);
      } else if (item.input_type === "text") {
        const filled = list.filter((entry) => {
          const value = customItemValue(entry, item.id);
          return typeof value === "string" && value.trim() !== "";
        }).length;
        display = `${filled} / ${dayCount}`;
      } else {
        const checked = list.filter((entry) => isCustomItemDone(entry, item)).length;
        display = `${checked} / ${dayCount}`;
      }
      recap.custom[key] = display;
      tr.append(cell(display));
    });

    tr.append(cell(`${pct}% (${done}/${denom})`));
    adminRecapRows.push(recap);
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.replaceChildren(table);
}

function renderCredentialManagement(profiles) {
  const wrap = $("credentialManagementList");
  if (!wrap || !currentProfile) return;

  const targets = profiles.filter((profile) => profile.id !== currentUser.id && (
    currentProfile.role === "super_admin"
      ? ["user", "admin"].includes(profile.role)
      : profile.role === "user" && String(profile.created_by) === String(currentUser.id)
  ));
  if (!targets.length) {
    wrap.textContent = "Belum ada akun yang dapat dikelola.";
    return;
  }

  const table = document.createElement("table");
  table.className = "admin-table";
  const headers = ["Pengguna", "ID login baru", "Kata sandi baru (opsional)"];
  if (currentProfile.role === "super_admin") headers.push("Pindahkan user ke admin");
  headers.push("Aksi");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((text) => headerRow.append(th(text)));
  thead.append(headerRow);
  table.append(thead);
  const tbody = document.createElement("tbody");

  const admins = profiles.filter((profile) => profile.role === "admin");
  targets.forEach((profile) => {
    const row = document.createElement("tr");
    const identity = document.createElement("td");
    identity.textContent = profile.full_name || profile.login_id || "-";
    const role = document.createElement("small");
    role.textContent = roleLabel(profile.role);
    identity.append(role);

    const loginCell = document.createElement("td");
    const loginInput = document.createElement("input");
    loginInput.type = "text";
    loginInput.className = "credential-input";
    loginInput.value = profile.login_id;
    loginInput.required = true;
    loginInput.minLength = 3;
    loginInput.maxLength = 32;
    loginInput.pattern = "[A-Za-z0-9._-]+";
    loginInput.setAttribute("aria-label", `ID login baru untuk ${profile.full_name || profile.login_id}`);
    loginCell.append(loginInput);

    const passwordCell = document.createElement("td");
    const passwordInput = document.createElement("input");
    passwordInput.type = "password";
    passwordInput.className = "credential-input";
    passwordInput.autocomplete = "new-password";
    passwordInput.minLength = 12;
    passwordInput.placeholder = "Minimal 12 karakter";
    passwordInput.setAttribute("aria-label", `Kata sandi baru untuk ${profile.full_name || profile.login_id}`);
    passwordCell.append(passwordInput);

    let managerCell = null;
    if (currentProfile.role === "super_admin") {
      managerCell = document.createElement("td");
      if (profile.role === "user") {
        const managerSelect = document.createElement("select");
        managerSelect.className = "role-select";
        managerSelect.setAttribute("aria-label", `Admin pengelola untuk ${profile.full_name || profile.login_id}`);
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Pilih admin";
        managerSelect.append(placeholder);
        admins.forEach((admin) => {
          const option = document.createElement("option");
          option.value = admin.id;
          option.textContent = admin.full_name || admin.login_id;
          option.selected = String(profile.created_by) === String(admin.id);
          managerSelect.append(option);
        });
        managerCell.append(managerSelect);

        const moveButton = document.createElement("button");
        moveButton.type = "button";
        moveButton.className = "secondary-button small";
        moveButton.textContent = "Pindahkan";
        moveButton.disabled = !admins.length;
        moveButton.addEventListener("click", async () => {
          const adminId = managerSelect.value;
          if (!adminId) {
            setCredentialMessage("Pilih admin tujuan terlebih dahulu.", "error");
            return;
          }
          if (String(profile.created_by) === adminId) {
            setCredentialMessage("User sudah dikelola oleh admin tersebut.", "error");
            return;
          }
          const destinationAdmin = admins.find((admin) => String(admin.id) === adminId);
          if (!confirm(`Pindahkan ${profile.full_name || profile.login_id} ke admin ${destinationAdmin?.full_name || destinationAdmin?.login_id}? Riwayat mutabaah user tetap tersimpan.`)) return;

          moveButton.disabled = true;
          setCredentialMessage("Memindahkan user...", "");
          try {
            const { data, error } = await supabase.functions.invoke("manage-user", {
              body: { action: "transfer", user_id: profile.id, admin_id: adminId },
            });
            if (error) {
              let message = error.message || "Gagal memindahkan user.";
              try {
                const body = await error.context?.json();
                if (body?.error) message = body.error;
              } catch {}
              throw new Error(message);
            }
            if (data?.error) throw new Error(data.error);
            profile.created_by = data.created_by;
            setCredentialMessage(`${profile.full_name || profile.login_id} sekarang dikelola oleh ${destinationAdmin?.full_name || destinationAdmin?.login_id}.`, "success");
            await renderAdminPanels();
          } catch (error) {
            setCredentialMessage(error.message || "Gagal memindahkan user.", "error");
          } finally {
            moveButton.disabled = false;
          }
        });
        managerCell.append(moveButton);
      } else {
        const label = document.createElement("span");
        label.textContent = "—";
        managerCell.append(label);
      }
    }

    const actionCell = document.createElement("td");
    actionCell.className = "row-actions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "primary-button small";
    saveButton.textContent = "Simpan";
    saveButton.addEventListener("click", async () => {
      if (!loginInput.reportValidity() || !passwordInput.reportValidity()) return;
      const login_id = loginInput.value.trim().toLowerCase();
      const password = passwordInput.value;
      if (login_id === profile.login_id.toLowerCase() && !password) {
        setCredentialMessage("Masukkan ID login baru atau kata sandi baru.", "error");
        return;
      }

      saveButton.disabled = true;
      setCredentialMessage("Menyimpan kredensial...", "");
      try {
        const { data, error } = await supabase.functions.invoke("reset-user-credentials", {
          body: { user_id: profile.id, login_id, password },
        });
        if (error) {
          let message = error.message || "Gagal mengubah kredensial.";
          try {
            const body = await error.context?.json();
            if (body?.error) message = body.error;
          } catch {}
          throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);
        profile.login_id = data.login_id;
        passwordInput.value = "";
        loginInput.value = data.login_id;
        setCredentialMessage(`Kredensial ${data.login_id} berhasil diperbarui.`, "success");
        await renderAdminPanels();
      } catch (error) {
        setCredentialMessage(error.message || "Gagal mengubah kredensial.", "error");
      } finally {
        saveButton.disabled = false;
      }
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button small";
    deleteButton.textContent = "Hapus";
    deleteButton.addEventListener("click", async () => {
      const targetName = profile.full_name || profile.login_id;
      const confirmation = profile.role === "admin"
        ? `Hapus admin ${targetName}? Akun admin akan dihapus. User yang dikelolanya tidak ikut dihapus dan perlu dipindahkan oleh super admin.`
        : `Hapus user ${targetName}? Seluruh data mutabaah user ini akan dihapus permanen.`;
      if (!confirm(confirmation)) return;

      deleteButton.disabled = true;
      saveButton.disabled = true;
      setCredentialMessage("Menghapus akun...", "");
      try {
        const { data, error } = await supabase.functions.invoke("manage-user", {
          body: { action: "delete", user_id: profile.id },
        });
        if (error) {
          let message = error.message || "Gagal menghapus akun.";
          try {
            const body = await error.context?.json();
            if (body?.error) message = body.error;
          } catch {}
          throw new Error(message);
        }
        if (data?.error) throw new Error(data.error);
        setCredentialMessage(`Akun ${targetName} berhasil dihapus.`, "success");
        await renderAdminPanels();
      } catch (error) {
        setCredentialMessage(error.message || "Gagal menghapus akun.", "error");
        deleteButton.disabled = false;
        saveButton.disabled = false;
      }
    });

    actionCell.append(saveButton, deleteButton);
    row.append(identity, loginCell, passwordCell);
    if (managerCell) row.append(managerCell);
    row.append(actionCell);
    tbody.append(row);
  });

  table.append(tbody);
  wrap.replaceChildren(table);
}

function setCredentialMessage(text, type = "") {
  const el = $("credentialManagementMessage");
  if (!el) return;
  el.textContent = text || "";
  el.className = `auth-message ${type}`.trim();
}

function renderCustomItemsManager() {
  const wrap = $("customItemsList");
  if (!wrap) return;
  const items = manageableItems();
  if (!items.length) {
    wrap.textContent = "Belum ada item isian.";
    return;
  }

  const profileMap = new Map(allVisibleProfiles.map((p) => [String(p.id), p]));
  const table = document.createElement("table");
  table.className = "admin-table";
  const showOwner = currentProfile.role === "super_admin";
  table.innerHTML = `<thead><tr>
    <th>Item</th><th>Jenis input</th>${showOwner ? "<th>Pembuat</th>" : ""}<th>Cakupan</th><th>Status</th><th>Aksi</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");

  items.forEach((item) => {
    const tr = document.createElement("tr");
    const labelTd = document.createElement("td");
    labelTd.textContent = item.label;
    labelTd.className = "item-label-cell";
    tr.append(labelTd);
    tr.append(cell(customItemTypeLabel(item.input_type)));

    if (showOwner) {
      const owner = profileMap.get(String(item.created_by));
      const ownerLabel = owner ? `${owner.full_name || owner.email || "-"} (${roleLabel(owner.role)})` : "-";
      tr.append(cell(ownerLabel));
    }

    const scope = item.creator_role === "super_admin"
      ? "Semua user (bawah admin & super admin)"
      : "User di bawah admin pembuat";
    tr.append(cell(scope));

    const statusTd = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill ${item.is_deleted ? "inactive" : item.is_active ? "active" : "inactive"}`;
    pill.textContent = item.is_deleted ? "Dihapus" : item.is_active ? "Aktif" : "Nonaktif";
    statusTd.append(pill);
    tr.append(statusTd);

    const actionTd = document.createElement("td");
    actionTd.className = "row-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary-button small";
    editBtn.textContent = "Ubah nama";
    editBtn.addEventListener("click", () => beginEditCustomItemLabel(tr, labelTd, item));

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "secondary-button small";
    toggleBtn.textContent = item.is_active ? "Nonaktifkan" : "Aktifkan";
    toggleBtn.addEventListener("click", async () => {
      toggleBtn.disabled = true;
      const { error } = await supabase.from("custom_items").update({ is_active: !item.is_active }).eq("id", item.id);
      toggleBtn.disabled = false;
      if (error) { alert(`Gagal mengubah item: ${error.message}`); return; }
      await loadCustomItems();
      render();
      await renderAdminPanels();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger-button small";
    delBtn.textContent = item.is_deleted ? "Pulihkan" : "Hapus";
    delBtn.addEventListener("click", async () => {
      if (!item.is_deleted && !confirm(`Hapus item isian "${item.label}" dari formulir? Riwayat yang sudah tercatat tetap tersimpan.`)) return;
      delBtn.disabled = true;
      const { error } = await supabase.from("custom_items")
        .update({ is_deleted: !item.is_deleted })
        .eq("id", item.id);
      delBtn.disabled = false;
      if (error) { alert(`Gagal menghapus item: ${error.message}`); return; }
      await loadCustomItems();
      render();
      await renderAdminPanels();
    });

    if (item.is_deleted) {
      actionTd.append(editBtn, delBtn);
    } else {
      actionTd.append(editBtn, toggleBtn, delBtn);
    }
    tr.append(actionTd);
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.replaceChildren(table);
}

function beginEditCustomItemLabel(row, labelTd, item) {
  if (row.dataset.editing === "true") return;
  row.dataset.editing = "true";
  const original = item.label;
  labelTd.textContent = "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-edit-input";
  input.value = original;
  input.setAttribute("aria-label", "Nama item");
  labelTd.append(input);
  input.focus();
  input.select();

  const actionTd = row.querySelector(".row-actions");
  const prevActions = Array.from(actionTd.childNodes);
  actionTd.replaceChildren();

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "primary-button small";
  saveBtn.textContent = "Simpan";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "secondary-button small";
  cancelBtn.textContent = "Batal";

  const finish = async (save) => {
    if (save) {
      const newLabel = input.value.trim();
      if (!newLabel) { input.focus(); return; }
      if (newLabel === original) {
        cancel();
        return;
      }
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      const { error } = await supabase.from("custom_items").update({ label: newLabel }).eq("id", item.id);
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      if (error) {
        alert(`Gagal mengubah nama item: ${error.message}`);
        return;
      }
      await loadCustomItems();
      render();
      await renderAdminPanels();
      return;
    }
    cancel();
  };

  const cancel = () => {
    row.dataset.editing = "false";
    labelTd.textContent = original;
    actionTd.replaceChildren(...prevActions);
  };

  saveBtn.addEventListener("click", () => finish(true));
  cancelBtn.addEventListener("click", () => finish(false));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });

  actionTd.append(saveBtn, cancelBtn);
}

function customItemTypeLabel(type) {
  if (type === "number") return "Angka (jumlah)";
  if (type === "text") return "Isi manual";
  return "Checklist";
}

function renderRoleManagement(profiles) {
  const wrap = $("roleManagement");
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Pengguna</th><th>ID login</th><th>Email</th><th>Role</th><th>Aksi</th></tr></thead>`;
  const tbody = document.createElement("tbody");

  profiles.forEach((p) => {
    const tr = document.createElement("tr");
    tr.append(cell(p.full_name || p.login_id || "-"), cell(p.login_id), cell(p.email || "-"));

    const roleTd = document.createElement("td");
    const select = document.createElement("select");
    select.className = "role-select";
    ["user", "admin", "super_admin"].forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = roleLabel(r);
      if (p.role === r) opt.selected = true;
      select.append(opt);
    });
    roleTd.append(select);

    const actionTd = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary-button small";
    btn.textContent = "Simpan";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "...";
      const { error } = await supabase.from("profiles").update({ role: select.value }).eq("id", p.id);
      btn.disabled = false;
      btn.textContent = "Simpan";
      if (error) {
        alert(`Gagal mengubah role: ${error.message}`);
        return;
      }
      p.role = select.value;
      if (p.id === currentUser.id) {
        currentProfile.role = select.value;
        updateRoleSections();
      }
      await loadCustomItems();
      render();
      await renderAdminPanels();
    });
    actionTd.append(btn);

    tr.append(roleTd, actionTd);
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.replaceChildren(table);
}

function th(text) {
  const el = document.createElement("th");
  el.textContent = text;
  return el;
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function downloadCsvRows(rows, filename) {
  const csv = rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadSummary() {
  const applicable = applicableItemsForSelf();
  const header = ["Tanggal"];
  header.push(...applicable.map((item) => item.label));
  header.push("Target selesai", "Progres harian", "Catatan");

  const rows = [header];
  const cursor = new Date();
  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - index);
    const key = dateKey(date);
    const data = weekEntries.find((e) => e.entry_date === key) || emptyEntry();
    const completed = completedCountForSelf(data);
    const total = totalTargetsForSelf();
    const row = [key];
    applicable.forEach((i) => {
      const value = customItemValue(data, i.id);
      row.push(i.input_type === "check" ? (isCustomItemDone(data, i) ? "Ya" : "Tidak") : value);
    });
    row.push(`${completed}/${total}`);
    row.push(`${total ? Math.round((completed / total) * 100) : 0}%`);
    row.push(data.notes || "");
    rows.push(row);
  }
  downloadCsvRows(rows, `summary-mutabaah-${dateKey(new Date())}.csv`);
}

function downloadRecap() {
  if (!adminRecapRows.length) return;
  const showManager = currentProfile?.role === "super_admin";
  const dayCount = inclusiveDayCount(adminRecapRange.from, adminRecapRange.to);
  const rangeLabel = formatRangeLabel(adminRecapRange.from, adminRecapRange.to);
  const customLabels = new Map();
  adminRecapRows.forEach((recap) => {
    Object.keys(recap.custom || {}).forEach((id) => {
      const item = allVisibleCustomItems.find((candidate) => String(candidate.id) === id);
      if (item) customLabels.set(id, item.label);
    });
  });
  const header = ["Nama", "Email"];
  if (showManager) header.push("Dikelola oleh");
  customLabels.forEach((label) => header.push(`${label} (${rangeLabel})`));
  header.push(`Target selesai (${rangeLabel})`, `Target maksimum (${rangeLabel})`, `Progres (${rangeLabel})`);

  const rows = [header, ...adminRecapRows.map((r) => {
    const row = [r.name, r.email];
    if (showManager) row.push(r.manager);
    customLabels.forEach((label, id) => row.push(String(r.custom?.[id] ?? "-")));
    row.push(String(r.done), String(r.denom), `${r.pct}%`);
    return row;
  })];
  const rangeSuffix = adminRecapRange.from === adminRecapRange.to
    ? adminRecapRange.from
    : `${adminRecapRange.from}_sd_${adminRecapRange.to}`;
  downloadCsvRows(rows, `rekap-mutabaah-${rangeSuffix}.csv`);
}

async function shiftDate(amount) {
  selectedDate.setDate(selectedDate.getDate() + amount);
  await loadEntry();
  render();
  setSaveStatus("Tersimpan");
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!supabase) return;
  const identifier = $("authIdentifier").value.trim();
  const password = $("authPassword").value;
  $("authSubmit").disabled = true;
  setAuthMessage("");
  try {
    const { data, error } = await supabase.functions.invoke("login", {
      body: { identifier, password },
    });
    if (error) {
      let msg = error.message || "ID/email atau kata sandi salah.";
      try {
        const body = await error.context?.json();
        if (body?.error) msg = body.error;
      } catch {}
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    if (!data?.session?.access_token || !data?.session?.refresh_token) {
      throw new Error("Respons login tidak lengkap. Coba lagi.");
    }
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (sessionError) throw sessionError;
    setAuthMessage("Berhasil masuk.", "success");
  } catch (err) {
    setAuthMessage(err.message || "ID/email atau kata sandi salah.", "error");
  } finally {
    $("authSubmit").disabled = false;
  }
}

async function handleCreateAccount(event) {
  event.preventDefault();
  if (!currentProfile) return;
  const full_name = $("newUserName").value.trim();
  const login_id = $("newUserLoginId").value.trim().toLowerCase();
  const password = $("newUserPassword").value;
  const role = currentProfile.role === "super_admin" ? $("newUserRole").value : "user";
  const btn = $("createAccountSubmit");
  btn.disabled = true;
  setCreateMessage("Membuat akun...", "");
  try {
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: { login_id, password, full_name, role },
    });
    if (error) {
      let msg = error.message || "Gagal membuat akun.";
      try {
        const body = await error.context?.json();
        if (body?.error) msg = body.error;
      } catch {}
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    setCreateMessage(`Akun berhasil dibuat. ID login: ${data.user.login_id} (${roleLabel(data.user.role)}).`, "success");
    $("createAccountForm").reset();
    if (currentProfile.role === "admin") $("newUserRole").value = "user";
    await renderAdminPanels();
  } catch (err) {
    setCreateMessage(err.message || "Gagal membuat akun.", "error");
  } finally {
    btn.disabled = false;
  }
}

async function handleCreateCustomItem(event) {
  event.preventDefault();
  if (!currentProfile || currentProfile.role === "user") return;
  const label = $("customItemLabel").value.trim();
  if (!label) return;
  const btn = $("customItemSubmit");
  btn.disabled = true;
  setCustomItemMessage("Menyimpan item...", "");
  try {
    const { error } = await supabase.from("custom_items").insert({
      label,
      input_type: $("customItemType").value,
      created_by: currentUser.id,
      creator_role: currentProfile.role,
      is_active: true,
    });
    if (error) throw error;
    $("customItemForm").reset();
    setCustomItemMessage("Item isian berhasil ditambahkan.", "success");
    await loadCustomItems();
    render();
    await renderAdminPanels();
  } catch (err) {
    setCustomItemMessage(err.message || "Gagal menambahkan item.", "error");
  } finally {
    btn.disabled = false;
  }
}

async function bootstrapSession(session) {
  if (!session?.user) {
    currentUser = null;
    currentProfile = null;
    allVisibleProfiles = [];
    allVisibleCustomItems = [];
    currentEntry = emptyEntry();
    weekEntries = [];
    adminRecapRows = [];
    showView(false);
    return;
  }
  currentUser = session.user;
  try {
    await loadProfile();
  } catch (err) {
    console.error(err);
    setAuthMessage("Profil tidak ditemukan. Pastikan schema Supabase sudah dijalankan dan akun memiliki profil.", "error");
    await supabase.auth.signOut();
    showView(false);
    return;
  }
  showView(true);
  updateRoleSections();
  await loadCustomItems();
  await Promise.all([loadEntry(), loadWeekEntries()]);
  render();
  setSaveStatus("Tersimpan");
  if (currentProfile.role !== "user") renderAdminPanels();
}

function bindEvents() {
  $("authForm").addEventListener("submit", handleAuthSubmit);
  $("logoutButton").addEventListener("click", async () => { await supabase.auth.signOut(); });

  if (typeof window !== "undefined") {
    if ("BroadcastChannel" in window) {
      recapChannel = new BroadcastChannel("mutabaah-recap");
      recapChannel.addEventListener("message", async (event) => {
        if (event.data?.type === "entry-updated" && currentProfile?.role !== "user") {
          await renderAdminPanels();
        }
      });
    }
    window.addEventListener("focus", async () => {
      if (currentProfile?.role !== "user") await renderAdminPanels();
    });
    document.addEventListener("visibilitychange", async () => {
      if (!document.hidden && currentProfile?.role !== "user") {
        await renderAdminPanels();
      }
    });
    window.setInterval(async () => {
      if (document.hidden || currentProfile?.role === "user") return;
      await loadCustomItems();
      await renderAdminPanels();
    }, 30000);
  }

  const recapPeriod = $("recapPeriod");
  const recapFrom = $("recapFrom");
  const recapTo = $("recapTo");
  recapFrom.value = adminRecapRange.from;
  recapTo.value = adminRecapRange.to;

  recapPeriod.addEventListener("change", () => {
    const today = new Date();
    const todayKey = dateKey(today);
    if (recapPeriod.value === "day") {
      recapFrom.value = todayKey;
      recapTo.value = todayKey;
    } else if (recapPeriod.value === "week") {
      recapFrom.value = addDaysToKey(todayKey, -6);
      recapTo.value = todayKey;
    } else if (recapPeriod.value === "month") {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      recapFrom.value = dateKey(first);
      recapTo.value = dateKey(last);
    }
  });

  $("applyRecapRange").addEventListener("click", async () => {
    const from = recapFrom.value;
    const to = recapTo.value;
    if (!from || !to) {
      $("adminUsersSummary").textContent = "Pilih tanggal mulai dan tanggal selesai.";
      return;
    }
    if (from > to) {
      $("adminUsersSummary").textContent = "Tanggal mulai tidak boleh setelah tanggal selesai.";
      return;
    }
    if (recapPeriod.value === "day") {
      recapTo.value = recapFrom.value;
    }
    adminRecapRange = {
      period: recapPeriod.value,
      from: recapPeriod.value === "day" ? recapFrom.value : from,
      to: recapPeriod.value === "day" ? recapFrom.value : to,
    };
    await loadCustomItems();
    await renderAdminPanels();
  });

  $("previousDay").addEventListener("click", () => shiftDate(-1));
  $("nextDay").addEventListener("click", () => shiftDate(1));
  $("todayButton").addEventListener("click", async () => {
    selectedDate = new Date();
    await loadEntry();
    render();
    setSaveStatus("Tersimpan");
  });

  const summaryCard = $("summaryCard");
  const summaryToggle = $("summaryToggle");
  const toggleSummary = (isOpen) => {
    summaryCard.hidden = !isOpen;
    summaryToggle.setAttribute("aria-expanded", String(isOpen));
  };
  summaryToggle.addEventListener("click", () => toggleSummary(summaryCard.hidden));
  $("summaryClose").addEventListener("click", () => toggleSummary(false));
  $("downloadSummary").addEventListener("click", downloadSummary);

  $("notes").addEventListener("input", (event) => {
    currentEntry.notes = event.target.value;
    scheduleSave(false);
  });

  $("refreshAdmin").addEventListener("click", async () => {
    await loadCustomItems();
    render();
    await renderAdminPanels();
  });
  $("downloadRecap").addEventListener("click", downloadRecap);
  $("createAccountForm").addEventListener("submit", handleCreateAccount);
  $("customItemForm").addEventListener("submit", handleCreateCustomItem);
}

async function init() {
  if (!isConfigured) {
    $("configWarning").hidden = false;
    $("authSubmit").disabled = true;
    showView(false);
    return;
  }

  bindEvents();
  const { data: { session } } = await supabase.auth.getSession();
  await bootstrapSession(session);

  supabase.auth.onAuthStateChange((_event, session) => {
    bootstrapSession(session);
  });
}

init();