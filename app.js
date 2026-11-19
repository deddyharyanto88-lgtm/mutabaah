const tasks = [
  { id: "dzikir", label: "Dzikir pagi & petang", category: "Dzikir" },
  { id: "sedekah", label: "Sedekah atau berbagi", category: "Akhlak" },
];

const storageKey = "mutabaah-yaumiah";
const state = JSON.parse(localStorage.getItem(storageKey) || "{}");
let selectedDate = new Date();

const dateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDayData = () => {
  const key = dateKey(selectedDate);
  if (!state[key]) state[key] = { completed: [], notes: "", prayerCount: 0, quranPages: 0 };
  return state[key];
};

const save = () => localStorage.setItem(storageKey, JSON.stringify(state));

function render() {
  const data = getDayData();
  const todayKey = dateKey(new Date());
  const isToday = dateKey(selectedDate) === todayKey;
  const completed = tasks.filter((task) => data.completed.includes(task.id)).length
    + (Number(data.prayerCount) > 0 ? 1 : 0)
    + (Number(data.quranPages) > 0 ? 1 : 0);
  const totalTargets = tasks.length + 2;
  const percentage = Math.round((completed / totalTargets) * 100);

  document.getElementById("dayName").textContent = isToday
    ? "Hari ini"
    : selectedDate.toLocaleDateString("id-ID", { weekday: "long" });
  document.getElementById("dateLabel").textContent = selectedDate.toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  });
  document.getElementById("completedCount").textContent = completed;
  document.getElementById("totalCount").textContent = totalTargets;
  document.getElementById("taskCount").textContent = `${totalTargets} target`;
  document.getElementById("progressPercent").textContent = `${percentage}%`;
  document.getElementById("progressBar").style.width = `${percentage}%`;
  document.getElementById("notes").value = data.notes;
  document.getElementById("prayerCount").value = data.prayerCount || 0;
  document.getElementById("quranPages").value = data.quranPages || "";
  document.getElementById("encouragement").textContent = percentage === 100
    ? "Masya Allah, semua target hari ini selesai!"
    : percentage >= 50 ? "Teruskan, sedikit lagi menuju selesai."
      : "Awali dengan satu kebaikan kecil.";

  const list = document.getElementById("taskList");
  list.replaceChildren(...tasks.map((task) => {
    const label = document.createElement("label");
    label.className = "task-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = data.completed.includes(task.id);
    input.addEventListener("change", () => {
      data.completed = input.checked
        ? [...data.completed, task.id]
        : data.completed.filter((id) => id !== task.id);
      save();
      render();
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
    return label;
  }));
  renderSummary();
}

function renderSummary() {
  const days = [];
  const cursor = new Date();
  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - index);
    days.push({ date, data: state[dateKey(date)] || { completed: [], prayerCount: 0, quranPages: 0 } });
  }
  const totalPrayer = days.reduce((sum, day) => sum + Number(day.data.prayerCount || 0), 0);
  const totalPages = days.reduce((sum, day) => sum + Number(day.data.quranPages || 0), 0);
  const completedTargets = days.reduce((sum, day) => sum
    + (Number(day.data.prayerCount) > 0 ? 1 : 0)
    + (Number(day.data.quranPages) > 0 ? 1 : 0)
    + tasks.filter((task) => day.data.completed?.includes(task.id)).length, 0);
  const targetPercentage = Math.round((completedTargets / (days.length * (tasks.length + 2))) * 100);

  document.getElementById("summaryPrayer").textContent = totalPrayer;
  document.getElementById("summaryPages").textContent = totalPages;
  document.getElementById("summaryTargets").textContent = `${targetPercentage}%`;
  document.getElementById("summaryDays").replaceChildren(...days.map((day) => {
    const targetCount = (Number(day.data.prayerCount) > 0 ? 1 : 0)
      + (Number(day.data.quranPages) > 0 ? 1 : 0)
      + tasks.filter((task) => day.data.completed?.includes(task.id)).length;
    const bar = document.createElement("div");
    bar.className = "summary-day";
    const label = document.createElement("span");
    label.textContent = day.date.toLocaleDateString("id-ID", { weekday: "short" }).replace(".", "");
    const track = document.createElement("div");
    track.className = "summary-bar";
    const fill = document.createElement("i");
    fill.style.height = `${(targetCount / (tasks.length + 2)) * 100}%`;
    track.append(fill);
    const count = document.createElement("small");
    count.textContent = `${targetCount}/${tasks.length + 2}`;
    bar.append(label, track, count);
    return bar;
  }));
}

function downloadSummary() {
  const rows = [
    ["Tanggal", "Salat wajib (jumlah)", "Tilawah (halaman)", "Dzikir pagi & petang", "Sedekah atau berbagi", "Target selesai", "Progres harian", "Catatan"],
  ];
  const cursor = new Date();
  for (let index = 6; index >= 0; index -= 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() - index);
    const data = state[dateKey(date)] || { completed: [], prayerCount: 0, quranPages: 0, notes: "" };
    const completed = (Number(data.prayerCount) > 0 ? 1 : 0)
      + (Number(data.quranPages) > 0 ? 1 : 0)
      + tasks.filter((task) => data.completed?.includes(task.id)).length;
    rows.push([
      dateKey(date),
      Number(data.prayerCount) || 0,
      Number(data.quranPages) || 0,
      data.completed?.includes("dzikir") ? "Ya" : "Tidak",
      data.completed?.includes("sedekah") ? "Ya" : "Tidak",
      `${completed}/${tasks.length + 2}`,
      `${Math.round((completed / (tasks.length + 2)) * 100)}%`,
      data.notes || "",
    ]);
  }

  const csv = rows.map((row) => row.map((value) => {
    const cell = String(value);
    const safeCell = /^[\s]*[=+\-@]/.test(cell) ? `'${cell}` : cell;
    return `"${safeCell.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `summary-mutabaah-${dateKey(new Date())}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function shiftDate(amount) {
  selectedDate.setDate(selectedDate.getDate() + amount);
  render();
}

document.getElementById("previousDay").addEventListener("click", () => shiftDate(-1));
document.getElementById("nextDay").addEventListener("click", () => shiftDate(1));
document.getElementById("todayButton").addEventListener("click", () => {
  selectedDate = new Date();
  render();
});
const summaryCard = document.getElementById("summaryCard");
const summaryToggle = document.getElementById("summaryToggle");
const toggleSummary = (isOpen) => {
  summaryCard.hidden = !isOpen;
  summaryToggle.setAttribute("aria-expanded", String(isOpen));
};
summaryToggle.addEventListener("click", () => toggleSummary(summaryCard.hidden));
document.getElementById("summaryClose").addEventListener("click", () => toggleSummary(false));
document.getElementById("downloadSummary").addEventListener("click", downloadSummary);
document.getElementById("notes").addEventListener("input", (event) => {
  getDayData().notes = event.target.value;
  save();
  document.getElementById("saveStatus").textContent = "Tersimpan otomatis";
});
document.getElementById("prayerCount").addEventListener("change", (event) => {
  getDayData().prayerCount = Number(event.target.value);
  save();
  render();
});
document.getElementById("quranPages").addEventListener("input", (event) => {
  getDayData().quranPages = Math.max(0, Number(event.target.value) || 0);
  save();
  document.getElementById("saveStatus").textContent = "Tersimpan otomatis";
  render();
});

render();
