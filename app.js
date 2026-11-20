import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const baseTasks = [
  { id: "dzikir", label: "Dzikir pagi & petang", category: "Dzikir" },
  { id: "sedekah", label: "Sedekah atau berbagi", category: "Akhlak" },
];

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
let saveTimer = null;

const $ = (id) => document.getElementById(id);

function emptyEntry() {
  return { prayer_count: 0, quran_pages: 0, dzikir: false, sedekah: false, notes: "", custom_checks: {} };
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
    prayer_count: Number(data.prayer_count) || 0,
    quran_pages: Number(data.quran_pages) || 0,
    dzikir: Boolean(data.dzikir),
    sedekah: Boolean(data.sedekah),
    notes: data.notes || "",
    custom_checks: (data.custom_checks && typeof data.custom_checks === "object" && !Array.isArray(data.custom_checks))
      ? data.custom_checks
      : {},
  };
}

function isCustomChecked(entry, itemId) {
  const checks = entry?.custom_checks || {};
  return Boolean(checks[String(itemId)]);
}

function setCustomChecked(entry, itemId, value) {
  if (!entry.custom_checks || typeof entry.custom_checks !== "object") entry.custom_checks = {};
  entry.custom_checks[String(itemId)] = Boolean(value);
}

function applicableItemsForProfile(profile) {
  if (!profile) return [];
  if (profile.role === "user") {
    return allVisibleCustomItems.filter((i) => i.is_active && (
      i.creator_role === "super_admin" ||
      (i.creator_role === "admin" && String(i.created_by) === String(profile.created_by))
    ));
  }
  if (profile.role === "admin") {
    return allVisibleCustomItems.filter((i) => i.is_active && i.creator_role === "super_admin");
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

function baseCompletedCount(entry) {
  const e = entry || emptyEntry();
  return (Number(e.prayer_count) > 0 ? 1 : 0)
    + (Number(e.quran_pages) > 0 ? 1 : 0)
    + (e.dzikir ? 1 : 0)
    + (e.sedekah ? 1 : 0);
}

function completedCountForProfile(entry, profile) {
  const items = applicableItemsForProfile(profile);
  const customDone = items.filter((i) => isCustomChecked(entry, i.id)).length;
  return baseCompletedCount(entry) + customDone;
}

function totalTargetsForProfile(profile) {
  return 4 + applicableItemsForProfile(profile).length;
}

function completedCountForSelf(entry) {
  const items = applicableItemsForSelf();
  const customDone = items.filter((i) => isCustomChecked(entry, i.id)).length;
  return baseCompletedCount(entry) + customDone;
}

function totalTargetsForSelf() {
  return 4 + applicableItemsForSelf().length;
}

function showView(loggedIn) {
  $("authSection").hidden = loggedIn;
  $("appSection").hidden = !loggedIn;
  $("appActions").hidden = !loggedIn;
  $("userArea").hidden = !loggedIn;
}

function updateUserArea() {
  if (!currentUser || !currentProfile) return;
  $("userName").textContent = currentProfile.full_name || currentUser.email || "Pengguna";
  $("userName").title = currentUser.email || "";
  const badge = $("userRoleBadge");
  badge.textContent = roleLabel(currentProfile.role);
  badge.className = `role-badge role-${currentProfile.role}`;
}

function updateRoleSections() {
  const role = currentProfile?.role || "user";
  const isAdmin = role === "admin";
  const isSuper = role === "super_admin";
  $("adminSection").hidden = !(isAdmin || isSuper);
  $("createAccountSection").hidden = !(isAdmin || isSuper);
  $("customItemsSection").hidden = !(isAdmin || isSuper);
  $("superAdminSection").hidden = !isSuper;

  if (isAdmin) {
    $("adminRecapTitle").textContent = "Rekap user di bawah saya (7 hari terakhir)";
    $("adminHint").textContent = "Menampilkan rekap mutabaah user yang Anda kelola (di bawah Anda), termasuk item tugas tambahan yang berlaku.";
    $("createAccountHint").textContent = "Buat akun baru untuk user. Akun akan berada di bawah pengelolaan Anda.";
    $("customItemsHint").textContent = "Tambah item tugas yang harus diisi oleh user di bawah otorisasi Anda. Item aktif akan muncul di mutabaah mereka.";
    $("newUserRoleField").hidden = true;
    $("newUserRole").value = "user";
  } else if (isSuper) {
    $("adminRecapTitle").textContent = "Rekap semua user (7 hari terakhir)";
    $("adminHint").textContent = "Menampilkan rekap semua user (di bawah admin dan super admin), termasuk item tugas tambahan yang berlaku.";
    $("createAccountHint").textContent = "Buat akun baru untuk admin atau user.";
    $("customItemsHint").textContent = "Tambah item tugas yang harus diisi oleh semua user (di bawah otorisasi admin dan super admin). Item aktif akan muncul di mutabaah mereka.";
    $("newUserRoleField").hidden = false;
  }
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, created_by")
    .eq("id", currentUser.id)
    .single();
  if (error) throw error;
  currentProfile = data;
}

async function loadCustomItems() {
  const { data, error } = await supabase
    .from("custom_items")
    .select("id, label, created_by, creator_role, is_active, created_at")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) {
    // tabel mungkin belum ada jika schema belum di-upgrade; jangan gagalkan seluruh sesi
    console.error(error);
    allVisibleCustomItems = [];
    return;
  }
  allVisibleCustomItems = data || [];
}

async function loadEntry() {
  const { data, error } = await supabase
    .from("mutabaah_entries")
    .select("entry_date, prayer_count, quran_pages, dzikir, sedekah, notes, custom_checks")
    .eq("user_id", currentUser.id)
    .eq("entry_date", dateKey(selectedDate))
    .maybeSingle();
  if (error) throw error;
  currentEntry = normalizeEntry(data);
}

async function loadWeekEntries() {
  const { data, error } = await supabase
    .from("mutabaah_entries")
    .select("entry_date, prayer_count, quran_pages, dzikir, sedekah, notes, custom_checks")
    .eq("user_id", currentUser.id)
    .gte("entry_date", sevenDaysAgoKey())
    .lte("entry_date", dateKey(new Date()));
  if (error) throw error;
  weekEntries = (data || []).map(normalizeEntryWithDate);
}

function normalizeEntryWithDate(data) {
  const e = normalizeEntry(data);
  e.entry_date = data.entry_date;
  return e;
}

async function saveEntry() {
  if (!currentUser) return;
  setSaveStatus("Menyimpan...");
  const payload = {
    user_id: currentUser.id,
    entry_date: dateKey(selectedDate),
    prayer_count: Number(currentEntry.prayer_count) || 0,
    quran_pages: Number(currentEntry.quran_pages) || 0,
    dzikir: Boolean(currentEntry.dzikir),
    sedekah: Boolean(currentEntry.sedekah),
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

function render() {
  if (!currentUser) return;
  const todayKey = dateKey(new Date());
  const isToday = dateKey(selectedDate) === todayKey;
  const applicable = applicableItemsForSelf();
  const completed = completedCountForSelf(currentEntry);
  const totalTargets = totalTargetsForSelf();
  const percentage = totalTargets ? Math.round((completed / totalTargets) * 100) : 0;

  $("dayName").textContent = isToday
    ? "Hari ini"
    : selectedDate.toLocaleDateString("id-ID", { weekday: "long" });
  $("dateLabel").textContent = selectedDate.toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  });
  $("completedCount").textContent = completed;
  $("totalCount").textContent = totalTargets;
  $("taskCount").textContent = `${totalTargets} target`;
  $("progressPercent").textContent = `${percentage}%`;
  $("progressBar").style.width = `${percentage}%`;
  $("notes").value = currentEntry.notes || "";
  $("prayerCount").value = String(currentEntry.prayer_count || 0);
  $("quranPages").value = currentEntry.quran_pages ? String(currentEntry.quran_pages) : "";
  $("encouragement").textContent = percentage === 100
    ? "Masya Allah, semua target hari ini selesai!"
    : percentage >= 50 ? "Teruskan, sedikit lagi menuju selesai."
      : "Awali dengan satu kebaikan kecil.";

  const list = $("taskList");
  const nodes = [];

  baseTasks.forEach((task) => {
    const label = document.createElement("label");
    label.className = "task-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(currentEntry[task.id]);
    input.addEventListener("change", () => {
      currentEntry[task.id] = input.checked;
      render();
      scheduleSave(true);
    });
    const checkmark = document.createElement("span");
    checkmark.className = "checkmark";
    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.label;
    const category = document.createElement("span");
    category.className = "task-category";
    category.textContent = task.category;
    label.append(input, checkmark, text, category);
    nodes.push(label);
  });

  applicable.forEach((item) => {
    const label = document.createElement("label");
    label.className = "task-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = isCustomChecked(currentEntry, item.id);
    input.addEventListener("change", () => {
      setCustomChecked(currentEntry, item.id, input.checked);
      render();
      scheduleSave(true);
    });
    const checkmark = document.createElement("span");
    checkmark.className = "checkmark";
    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = item.label;
    const category = document.createElement("span");
    category.className = "task-category";
    category.textContent = "Tugas tambahan";
    label.append(input, checkmark, text, category);
    nodes.push(label);
  });

  list.replaceChildren(...nodes);
  renderSummary();
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

  const totalPrayer = days.reduce((sum, day) => sum + Number(day.data.prayer_count || 0), 0);
  const totalPages = days.reduce((sum, day) => sum + Number(day.data.quran_pages || 0), 0);
  const totalTargetsPerDay = totalTargetsForSelf();
  const completedTargets = days.reduce((sum, day) => sum + completedCountForSelf(day.data), 0);
  const denom = days.length * (totalTargetsPerDay || 1);
  const targetPercentage = Math.round((completedTargets / denom) * 100);

  $("summaryPrayer").textContent = totalPrayer;
  $("summaryPages").textContent = totalPages;
  $("summaryTargets").textContent = `${targetPercentage}%`;

  const dayLabel = (date) => date.toLocaleDateString("id-ID", { weekday: "short" }).replace(".", "");
  const maxPages = Math.max(5, ...days.map((day) => Number(day.data.quran_pages || 0)));

  const statusRows = [
    { label: "Dzikir", days: days.map((day) => ({ label: dayLabel(day.date), done: Boolean(day.data.dzikir) })) },
    { label: "Sedekah", days: days.map((day) => ({ label: dayLabel(day.date), done: Boolean(day.data.sedekah) })) },
    ...applicable.map((item) => ({
      label: item.label,
      days: days.map((day) => ({ label: dayLabel(day.date), done: isCustomChecked(day.data, item.id) })),
    })),
  ];

  const charts = $("summaryCharts");
  charts.replaceChildren(
    createBarChart({
      title: "Salat wajib",
      subtitle: "jumlah per hari",
      max: 5,
      unit: "salat",
      tone: "teal",
      days: days.map((day) => ({
        label: dayLabel(day.date),
        value: Number(day.data.prayer_count || 0),
        display: `${Number(day.data.prayer_count || 0)}/5`,
      })),
    }),
    createBarChart({
      title: "Tilawah Al-Qur'an",
      subtitle: "halaman per hari",
      max: maxPages,
      unit: "hal",
      tone: "gold",
      days: days.map((day) => ({
        label: dayLabel(day.date),
        value: Number(day.data.quran_pages || 0),
        display: `${Number(day.data.quran_pages || 0)}`,
      })),
    }),
    createStatusChart({
      title: "Dzikir, Sedekah & Tugas Tambahan",
      subtitle: "status per hari",
      rows: statusRows,
    }),
  );
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
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
    byUser.get(e.user_id).push(e);
  });
  return byUser;
}

async function renderAdminPanels() {
  if (!currentProfile || currentProfile.role === "user") return;
  const from = sevenDaysAgoKey();
  const to = dateKey(new Date());

  const [profilesRes, entriesRes] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, role, created_by, created_at").order("created_at", { ascending: true }),
    supabase.from("mutabaah_entries").select("user_id, entry_date, prayer_count, quran_pages, dzikir, sedekah, custom_checks").gte("entry_date", from).lte("entry_date", to),
  ]);

  if (profilesRes.error || entriesRes.error) {
    $("adminUsersSummary").textContent = "Gagal memuat data.";
    console.error(profilesRes.error || entriesRes.error);
    return;
  }

  allVisibleProfiles = profilesRes.data || [];
  const entries = (entriesRes.data || []).map(normalizeEntryWithDate);
  const byUser = groupEntriesByUser(entries);

  let scopedUsers;
  if (currentProfile.role === "admin") {
    scopedUsers = allVisibleProfiles.filter((p) => String(p.created_by) === String(currentUser.id) && p.role === "user");
  } else {
    scopedUsers = allVisibleProfiles.filter((p) => p.role === "user");
  }

  renderAdminSummary(scopedUsers, byUser);
  renderCustomItemsManager();
  if (currentProfile.role === "super_admin") renderRoleManagement(allVisibleProfiles);
}

function renderAdminSummary(users, byUser) {
  const wrap = $("adminUsersSummary");
  adminRecapRows = [];
  if (!users.length) {
    wrap.textContent = "Belum ada user pada cakupan ini.";
    return;
  }

  const profileMap = new Map(allVisibleProfiles.map((p) => [String(p.id), p]));
  const showManager = currentProfile.role === "super_admin";
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr>
    <th>Pengguna</th>${showManager ? "<th>Dikelola oleh</th>" : ""}<th>Salat (7h)</th><th>Halaman (7h)</th><th>Target (7h)</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");

  users.forEach((p) => {
    const list = byUser.get(p.id) || [];
    const prayer = list.reduce((s, e) => s + Number(e.prayer_count || 0), 0);
    const pages = list.reduce((s, e) => s + Number(e.quran_pages || 0), 0);
    const perDay = totalTargetsForProfile(p);
    const done = list.reduce((s, e) => s + completedCountForProfile(e, p), 0);
    const denom = 7 * perDay;
    const pct = denom ? Math.round((done / denom) * 100) : 0;
    const manager = p.created_by ? profileMap.get(String(p.created_by)) : null;
    const managerLabel = manager
      ? `${manager.full_name || manager.email || "-"} (${roleLabel(manager.role)})`
      : "-";

    adminRecapRows.push({
      name: p.full_name || "-",
      email: p.email || "",
      manager: managerLabel,
      prayer,
      pages,
      done,
      denom,
      pct,
    });

    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.innerHTML = `<strong>${escapeHtml(p.full_name || "-")}</strong><small>${escapeHtml(p.email || "")}</small>`;
    tr.append(name);
    if (showManager) tr.append(cell(managerLabel));
    tr.append(cell(`${prayer} / 35`), cell(String(pages)), cell(`${pct}% (${done}/${denom})`));
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.replaceChildren(table);
}

function renderCustomItemsManager() {
  const wrap = $("customItemsList");
  if (!wrap) return;
  const items = manageableItems();
  if (!items.length) {
    wrap.textContent = "Belum ada item tugas tambahan.";
    return;
  }

  const profileMap = new Map(allVisibleProfiles.map((p) => [String(p.id), p]));
  const table = document.createElement("table");
  table.className = "admin-table";
  const showOwner = currentProfile.role === "super_admin";
  table.innerHTML = `<thead><tr>
    <th>Item</th>${showOwner ? "<th>Pembuat</th>" : ""}<th>Cakupan</th><th>Status</th><th>Aksi</th>
  </tr></thead>`;
  const tbody = document.createElement("tbody");

  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.append(cell(item.label));

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
    pill.className = `status-pill ${item.is_active ? "active" : "inactive"}`;
    pill.textContent = item.is_active ? "Aktif" : "Nonaktif";
    statusTd.append(pill);
    tr.append(statusTd);

    const actionTd = document.createElement("td");
    actionTd.className = "row-actions";
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
    delBtn.textContent = "Hapus";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Hapus item "${item.label}"?`)) return;
      delBtn.disabled = true;
      const { error } = await supabase.from("custom_items").delete().eq("id", item.id);
      delBtn.disabled = false;
      if (error) { alert(`Gagal menghapus item: ${error.message}`); return; }
      await loadCustomItems();
      render();
      await renderAdminPanels();
    });

    actionTd.append(toggleBtn, delBtn);
    tr.append(actionTd);
    tbody.append(tr);
  });

  table.append(tbody);
  wrap.replaceChildren(table);
}

function renderRoleManagement(profiles) {
  const wrap = $("roleManagement");
  const table = document.createElement("table");
  table.className = "admin-table";
  table.innerHTML = `<thead><tr><th>Pengguna</th><th>Email</th><th>Role</th><th>Aksi</th></tr></thead>`;
  const tbody = document.createElement("tbody");

  profiles.forEach((p) => {
    const tr = document.createElement("tr");
    tr.append(cell(p.full_name || "-"), cell(p.email || "-"));

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
        updateUserArea();
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
  const header = [
    "Tanggal", "Salat wajib (jumlah)", "Tilawah (halaman)", "Dzikir pagi & petang", "Sedekah atau berbagi",
    ...applicable.map((i) => i.label),
    "Target selesai", "Progres harian", "Catatan",
  ];
  const rows = [header];
  const cursor = new Date();
  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - index);
    const key = dateKey(date);
    const data = weekEntries.find((e) => e.entry_date === key) || emptyEntry();
    const completed = completedCountForSelf(data);
    const total = totalTargetsForSelf();
    rows.push([
      key,
      Number(data.prayer_count) || 0,
      Number(data.quran_pages) || 0,
      data.dzikir ? "Ya" : "Tidak",
      data.sedekah ? "Ya" : "Tidak",
      ...applicable.map((i) => (isCustomChecked(data, i.id) ? "Ya" : "Tidak")),
      `${completed}/${total}`,
      `${total ? Math.round((completed / total) * 100) : 0}%`,
      data.notes || "",
    ]);
  }
  downloadCsvRows(rows, `summary-mutabaah-${dateKey(new Date())}.csv`);
}

function downloadRecap() {
  if (!adminRecapRows.length) return;
  const showManager = currentProfile?.role === "super_admin";
  const header = [
    "Nama",
    "Email",
    ...(showManager ? ["Dikelola oleh"] : []),
    "Salat (7 hari)",
    "Halaman tilawah (7 hari)",
    "Target selesai (7 hari)",
    "Target maksimum (7 hari)",
    "Progres (7 hari)",
  ];
  const rows = [header, ...adminRecapRows.map((r) => [
    r.name,
    r.email,
    ...(showManager ? [r.manager] : []),
    `${r.prayer}/35`,
    String(r.pages),
    String(r.done),
    String(r.denom),
    `${r.pct}%`,
  ])];
  downloadCsvRows(rows, `rekap-mutabaah-${dateKey(new Date())}.csv`);
}

async function shiftDate(amount) {
  selectedDate.setDate(selectedDate.getDate() + amount);
  await loadEntry();
  render();
  setSaveStatus("Tersimpan");
}

function openNameEdit() {
  $("userIdentity").hidden = true;
  $("nameEditForm").hidden = false;
  $("nameEditInput").value = currentProfile?.full_name || "";
  $("nameEditInput").focus();
}

function closeNameEdit() {
  $("nameEditForm").hidden = true;
  $("userIdentity").hidden = false;
}

async function handleNameSave(event) {
  event.preventDefault();
  if (!currentProfile) return;
  const newName = $("nameEditInput").value.trim();
  if (!newName) return;
  const btn = $("nameSaveBtn");
  btn.disabled = true;
  const { error } = await supabase.from("profiles").update({ full_name: newName }).eq("id", currentUser.id);
  btn.disabled = false;
  if (error) {
    alert(`Gagal mengubah nama: ${error.message}`);
    return;
  }
  currentProfile.full_name = newName;
  updateUserArea();
  closeNameEdit();
  if (currentProfile.role !== "user") renderAdminPanels();
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!supabase) return;
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  $("authSubmit").disabled = true;
  setAuthMessage("");
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    setAuthMessage("Berhasil masuk.", "success");
  } catch (err) {
    setAuthMessage(err.message || "Gagal masuk.", "error");
  } finally {
    $("authSubmit").disabled = false;
  }
}

async function handleCreateAccount(event) {
  event.preventDefault();
  if (!currentProfile) return;
  const full_name = $("newUserName").value.trim();
  const email = $("newUserEmail").value.trim();
  const password = $("newUserPassword").value;
  const role = currentProfile.role === "super_admin" ? $("newUserRole").value : "user";
  const btn = $("createAccountSubmit");
  btn.disabled = true;
  setCreateMessage("Membuat akun...", "");
  try {
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: { email, password, full_name, role },
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
    setCreateMessage(`Akun berhasil dibuat: ${data.user.email} (${roleLabel(data.user.role)}).`, "success");
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
      created_by: currentUser.id,
      creator_role: currentProfile.role,
      is_active: true,
    });
    if (error) throw error;
    $("customItemForm").reset();
    setCustomItemMessage("Item tugas berhasil ditambahkan.", "success");
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
  updateUserArea();
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

  $("editNameButton").addEventListener("click", openNameEdit);
  $("nameEditCancel").addEventListener("click", closeNameEdit);
  $("nameEditForm").addEventListener("submit", handleNameSave);

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
  $("prayerCount").addEventListener("change", (event) => {
    currentEntry.prayer_count = Number(event.target.value);
    render();
    scheduleSave(true);
  });
  $("quranPages").addEventListener("input", (event) => {
    currentEntry.quran_pages = Math.max(0, Number(event.target.value) || 0);
    render();
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
