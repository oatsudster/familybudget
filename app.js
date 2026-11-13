"use strict";
(() => {
  const firebaseConfig = {
    apiKey: "AIzaSyB9CQPK_is8JE_SAswKXqzIJpRFIYg1tOw",
    authDomain: "family-budget-f47bb.firebaseapp.com",
    projectId: "family-budget-f47bb",
    storageBucket: "family-budget-f47bb.firebasestorage.app",
    messagingSenderId: "1068240277908",
    appId: "1:1068240277908:web:1c522f96789143f183bf81",
  };
  const CATEGORIES = {
    income: [
      { id: "salary", em: "💵", label: "เงินเดือน" },
      { id: "palm", em: "🌴", label: "ค่าขายปาล์ม" },
      { id: "interest", em: "📈", label: "ดอกเบี้ย" },
      { id: "other_in", em: "✨", label: "อื่นๆ" },
    ],
    expense: [
      { id: "food", em: "🍚", label: "อาหาร" },
      { id: "utility", em: "💡", label: "ค่าน้ำ-ไฟ" },
      { id: "shopping", em: "🛒", label: "ของใช้" },
      { id: "thaisombun", em: "🏪", label: "ของไทยสมบูรณ์" },
      { id: "snack", em: "🍿", label: "ขนม" },
      { id: "home", em: "🏠", label: "ค่าเช่าบ้าน" },
      { id: "shopee", em: "🛍️", label: "Shopee" },
      { id: "amway", em: "🧴", label: "Amway" },
      { id: "gwallet", em: "📱", label: "เติม G-wallet" },
      { id: "beer", em: "🍺", label: "ค่าขายเบียร์" },
      { id: "wifi", em: "📶", label: "3BB wifi" },
      { id: "other_out", em: "📦", label: "อื่นๆ" },
    ],
  };

  const $ = (id) => document.getElementById(id);
  const hide = (id, value = true) => $(id).classList.toggle("hidden", value);
  const fmt = (n) =>
    Number(n).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  const cents = (n) => Math.round(Number(n) * 100);
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  const catInfo = (type, id) =>
    (CATEGORIES[type] || []).find((c) => c.id === id) || {
      em: "📒",
      label: id,
    };
  const monthKey = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const todayStr = () =>
    `${monthKey(new Date())}-${String(new Date().getDate()).padStart(2, "0")}`;
  const timeStr = () => new Date().toTimeString().slice(0, 5);
  const thaiDate = (str) =>
    new Date(`${str}T12:00:00`).toLocaleDateString("th-TH", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const validId = (id) =>
    typeof id === "string" && /^[a-zA-Z0-9_-]{20,128}$/.test(id);
  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* Link still works when storage is unavailable. */
      }
    },
  };
  let db,
    householdId,
    justMinted = false,
    persistenceReady = false;
  let currentTx = [],
    amwayItems = [],
    viewMonth = new Date(),
    runningBalances = {};
  let selectedType = "expense",
    selectedCat = null,
    editingId = null,
    selectedId = null,
    newTxRef = null;
  let busy = false,
    confirmTarget = null,
    catalogEditId = null,
    toastTimer;
  let unsubscribe = [],
    listening = false;
  const streams = { transactions: {}, catalog: {} };

  // Keep the last row clear of a taller action bar when text is enlarged.
  if (window.ResizeObserver) {
    new ResizeObserver(([entry]) => {
      if (entry.target.offsetHeight > 0)
        document.documentElement.style.setProperty(
          "--action-bar-height",
          `${entry.target.offsetHeight}px`,
        );
    }).observe($("addRow"));
  }
  // iOS's keyboard can shrink only the visual viewport, not the layout viewport.
  if (window.visualViewport) {
    const fitKeyboard = () => {
      const viewport = window.visualViewport;
      if (viewport.scale !== 1) return; // Preserve native pinch zoom.
      document.documentElement.style.setProperty(
        "--visible-height",
        `${viewport.height}px`,
      );
      document.documentElement.style.setProperty(
        "--keyboard-offset",
        `${Math.max(0, innerHeight - viewport.height - viewport.offsetTop)}px`,
      );
    };
    window.visualViewport.addEventListener("resize", fitKeyboard);
    window.visualViewport.addEventListener("scroll", fitKeyboard);
    fitKeyboard();
  }

  function showToast(text) {
    clearTimeout(toastTimer);
    $("toast").textContent = text;
    hide("toast", false);
    toastTimer = setTimeout(() => hide("toast"), 5500);
  }
  function errorAt(id, text) {
    $(id).textContent = text;
    hide(id, false);
  }
  function money(value) {
    const raw = String(value).trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return NaN;
    const result = Number(raw.replace(/,/g, ""));
    return result > 0 && result <= 1000000000000 ? result : NaN;
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T12:00:00`);
    return (
      !Number.isNaN(d.valueOf()) &&
      `${monthKey(d)}-${String(d.getDate()).padStart(2, "0")}` === value
    );
  }
  function timestampValue(t) {
    return t?.toMillis ? t.toMillis() : 0;
  }
  function chronological(a, b) {
    return (
      `${a.date} ${a.time || "00:00"}`.localeCompare(
        `${b.date} ${b.time || "00:00"}`,
      ) ||
      timestampValue(a.createdAt) - timestampValue(b.createdAt) ||
      a.id.localeCompare(b.id)
    );
  }
  function getHouseholdId() {
    const url = new URL(location.href);
    const supplied = url.searchParams.get("h");
    if (supplied !== null) {
      if (!validId(supplied)) return null;
      storage.set("familyBudgetHousehold", supplied);
      return supplied;
    }
    let id = storage.get("familyBudgetHousehold");
    if (!validId(id)) {
      id = crypto.randomUUID();
      justMinted = true;
    }
    storage.set("familyBudgetHousehold", id);
    url.searchParams.set("h", id);
    history.replaceState(null, "", url);
    return id;
  }
  function showSetupScreen() {
    hide("app");
    hide("setupScreen", false);
    $("setupTitle").textContent = justMinted
      ? "สมุดบัญชีใหม่พร้อมแล้ว"
      : "ลิงก์สมุดเงินครอบครัว";
    if (householdId) {
      const url = new URL(location.href);
      url.search = "";
      url.hash = "";
      url.searchParams.set("h", householdId);
      $("shareLink").value = url.href;
    } else {
      hide("shareSection");
      $("setupTitle").textContent = "ลิงก์นี้ไม่ครบหรือไม่ถูกต้อง";
      $("setupDescription").textContent =
        "วางลิงก์เดิมที่ได้รับจากครอบครัวด้านล่างเพื่อเปิดสมุดบัญชี";
    }
  }
  $("copyLinkBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("shareLink").value);
      showToast("คัดลอกลิงก์แล้ว");
    } catch {
      $("shareLink").focus();
      $("shareLink").select();
      showToast("แตะค้างที่ลิงก์ แล้วเลือกคัดลอก");
    }
  };
  $("joinLinkBtn").onclick = () => {
    const raw = $("joinLinkInput").value.trim();
    let id = raw;
    try {
      const url = new URL(raw);
      id = url.searchParams.get("h");
    } catch {
      /* Also support a pasted household ID. */
    }
    if (!validId(id))
      return errorAt("joinError", "ลิงก์ไม่ครบ กรุณาคัดลอกลิงก์ทั้งหมดแล้ววางอีกครั้ง");
    const target = new URL(location.href);
    target.search = "";
    target.hash = "";
    target.searchParams.set("h", id);
    location.assign(target.href);
  };
  $("enterAppBtn").onclick = startApp;
  $("linkBtn").onclick = showSetupScreen;

  function updateSync() {
    const states = Object.values(streams);
    const error = states.some((s) => s.error);
    const pending = busy || states.some((s) => s.pending);
    let text,
      state = "loading";
    if (!navigator.onLine) {
      state = "offline";
      text = pending
        ? "ยังส่งข้อมูลไม่ได้ · รออินเทอร์เน็ต"
        : "ออฟไลน์ · แสดงข้อมูลที่มีในเครื่อง";
    } else if (error) {
      state = "error";
      text = "เชื่อมต่อข้อมูลไม่สำเร็จ · ลองใหม่อีกครั้ง";
    } else if (pending) {
      state = "saving";
      text = "กำลังบันทึก…";
    } else if (states.some((s) => !s.received || s.fromCache)) {
      text = "กำลังตรวจสอบข้อมูลล่าสุด…";
    } else {
      state = "ok";
      text = "✓ บันทึกครบแล้ว";
    }
    $("syncText").textContent = text;
    $("syncBadge").dataset.state = state;
    hide("retryBtn", !error);
    hide("savingHelp", !busy);
    if (busy)
      $("savingHelp").textContent = navigator.onLine
        ? "กำลังส่งข้อมูล กรุณารอสักครู่"
        : "รออินเทอร์เน็ต หน้านี้จะส่งข้อมูลต่ออัตโนมัติ กรุณาเปิดหน้านี้ไว้";
  }
  function setBusy(value) {
    busy = value;
    $("editorFields").disabled = value;
    $("saveBtn").disabled = value;
    $("addIncomeBtn").disabled = value;
    $("addExpenseBtn").disabled = value;
    $("editBtn").disabled = value;
    $("deleteBtn").disabled = value;
    $("confirmDeleteBtn").disabled = value;
    $("confirmCancelBtn").disabled = value;
    $("cancelBtn").textContent = value ? "กลับหน้าหลัก" : "ยกเลิก";
    updateSaveLabel();
    updateSync();
  }
  function listenData() {
    unsubscribe.forEach((fn) => fn());
    unsubscribe = [];
    for (const key of Object.keys(streams)) streams[key] = {};
    const listen = (key, query, callback) => {
      unsubscribe.push(
        query.onSnapshot(
          { includeMetadataChanges: true },
          (snap) => {
            const serverSeen =
              streams[key].serverSeen || !snap.metadata.fromCache;
            streams[key] = {
              received: true,
              fromCache: snap.metadata.fromCache,
              pending: snap.metadata.hasPendingWrites,
              serverSeen,
            };
            // An empty cache is not evidence that the household balance is zero.
            if (
              key === "transactions" &&
              snap.metadata.fromCache &&
              snap.docs.length === 0 &&
              !serverSeen &&
              !snap.metadata.hasPendingWrites
            ) {
              hide("loadingState", false);
              $("loadingState").textContent =
                "กำลังรอข้อมูลล่าสุด หากยังไม่เคยเปิดสมุดนี้ กรุณาเชื่อมต่ออินเทอร์เน็ต";
            } else callback(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
            updateSync();
          },
          (err) => {
            streams[key].error = true;
            updateSync();
            if (key === "transactions") {
              hide("loadingState", false);
              $("loadingState").textContent =
                "โหลดข้อมูลไม่สำเร็จ กรุณากดลองเชื่อมต่อใหม่";
            }
            console.error("Data connection failed:", err.code);
          },
        ),
      );
    };
    listen("transactions", txCollection().orderBy("date", "desc"), (rows) => {
      currentTx = rows.filter(
        (t) =>
          ["income", "expense"].includes(t.type) &&
          validDate(t.date) &&
          Number.isFinite(Number(t.amount)),
      );
      hide("loadingState");
      renderAll();
    });
    listen("catalog", catalogCollection().orderBy("name"), (rows) => {
      amwayItems = rows;
      renderAmwaySelect();
    });
    updateSync();
  }
  function startApp() {
    if (!householdId) return;
    hide("setupScreen");
    hide("app", false);
    renderMonthLabel();
    if (db && persistenceReady && !listening) {
      listening = true;
      listenData();
    }
  }
  const txCollection = () =>
    db.collection("households").doc(householdId).collection("transactions");
  const catalogCollection = () =>
    db.collection("households").doc(householdId).collection("amwayItems");
  $("retryBtn").onclick = () => {
    if (db) listenData();
    else location.reload();
  };
  window.addEventListener("offline", updateSync);
  window.addEventListener("online", () => {
    if (Object.values(streams).some((s) => s.error) && db) listenData();
    else updateSync();
  });
  function renderMonthLabel() {
    const label = viewMonth.toLocaleDateString("th-TH", {
      month: "long",
      year: "numeric",
    });
    $("monthLabel").textContent = label;
    $("listTitle").textContent = `รายการ · ${label}`;
    hide("todayBtn", monthKey(viewMonth) === monthKey(new Date()));
  }
  function renderCategorySummary(id, sums, type) {
    $(id).innerHTML =
      Object.entries(sums)
        .sort((a, b) => b[1] - a[1])
        .map(([key, sum]) => {
          const cat = catInfo(type, key);
          return `<div class="summaryRow"><span>${cat.em} ${escapeHtml(cat.label)}</span><span class="amt">${fmt(sum / 100)} บาท</span></div>`;
        })
        .join("") || '<p class="summaryEmpty">ไม่มีรายการ</p>';
  }
  function renderAll() {
    const sorted = [...currentTx].sort(chronological);
    let running = 0;
    runningBalances = {};
    sorted.forEach((t) => {
      running += (t.type === "income" ? 1 : -1) * cents(t.amount);
      runningBalances[t.id] = running / 100;
    });
    $("balanceAmount").textContent = fmt(running / 100);
    $("balanceAmount").classList.toggle("negative", running < 0);
    const monthly = sorted
      .filter((t) => t.date.slice(0, 7) === monthKey(viewMonth))
      .reverse();
    const sums = { income: 0, expense: 0 },
      categories = { income: {}, expense: {} };
    monthly.forEach((t) => {
      const amount = cents(t.amount);
      sums[t.type] += amount;
      categories[t.type][t.category] =
        (categories[t.type][t.category] || 0) + amount;
    });
    $("monthIncome").textContent = `+${fmt(sums.income / 100)}`;
    $("monthExpense").textContent = `−${fmt(sums.expense / 100)}`;
    const net = sums.income - sums.expense;
    $("netAmount").textContent =
      `${net < 0 ? "−" : "+"}${fmt(Math.abs(net) / 100)} บาท`;
    $("netAmount").className = net < 0 ? "expense" : "income";
    renderCategorySummary("expenseSummaryList", categories.expense, "expense");
    renderCategorySummary("incomeSummaryList", categories.income, "income");
    renderMonthLabel();
    $("txCount").textContent = `${monthly.length} รายการ`;
    const focusedId = document.activeElement?.dataset?.transaction;
    const list = $("txList");
    list.replaceChildren();
    let lastDay;
    monthly.forEach((t) => {
      if (t.date !== lastDay) {
        const heading = document.createElement("h3");
        heading.className = "dayLabel";
        heading.textContent =
          (t.date === todayStr() ? "วันนี้ · " : "") + thaiDate(t.date);
        list.appendChild(heading);
        lastDay = t.date;
      }
      const cat = catInfo(t.type, t.category),
        button = document.createElement("button");
      button.className = "txItem";
      button.dataset.flow = t.type;
      button.dataset.transaction = t.id;
      button.innerHTML = `<span class="title">${escapeHtml(t.note || cat.label)}</span><span class="amt ${t.type}">${t.type === "income" ? "+" : "−"}${fmt(t.amount)}</span><span class="meta"><span class="typeLabel">${t.type === "income" ? "เงินเข้า" : "เงินออก"}</span> · ${cat.em} ${escapeHtml(cat.label)}${t.quantity > 1 ? " · " + fmt(t.quantity) + " ชิ้น" : ""}</span><span class="detailCue">ดูรายละเอียด ›</span>`;
      button.onclick = () => openDetail(t.id);
      list.appendChild(button);
      if (focusedId === t.id) button.focus({ preventScroll: true });
    });
    hide("emptyState", monthly.length > 0);
    if ($("detailDialog").open) {
      const selected = currentTx.find((t) => t.id === selectedId);
      if (selected) renderDetail(selected);
      else {
        $("detailDialog").close();
        showToast("รายการนี้ถูกลบแล้ว");
      }
    }
  }
  $("prevMonth").onclick = () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
    renderAll();
  };
  $("nextMonth").onclick = () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
    renderAll();
  };
  $("todayBtn").onclick = () => {
    viewMonth = new Date();
    renderAll();
  };
  $("summaryToggleBtn").onclick = () => {
    const expanded =
      $("summaryToggleBtn").getAttribute("aria-expanded") !== "true";
    $("summaryToggleBtn").setAttribute("aria-expanded", expanded);
    hide("categorySummary", !expanded);
    $("summaryChevron").textContent = expanded ? "⌃" : "⌄";
  };

  // Native dialogs provide a focus trap, Escape handling, and an inert background.
  function showDialog(id) {
    if (!$(id).open) $(id).showModal();
    $(id).querySelector(".sheetBody")?.scrollTo?.(0, 0);
  }
  function closeEditor() {
    $("editor").close();
    if (busy) showToast("ยังมีรายการรอส่ง กรุณาเปิดหน้านี้ไว้จนบันทึกครบ");
  }
  $("closeEditorBtn").onclick = closeEditor;
  $("cancelBtn").onclick = closeEditor;
  $("editor").addEventListener("cancel", (e) => {
    e.preventDefault();
    closeEditor();
  });
  $("closeDetailBtn").onclick = () => $("detailDialog").close();
  $("confirmDialog").addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  function renderDetail(t) {
    const cat = catInfo(t.type, t.category);
    $("detailDialog").dataset.flow = t.type;
    $("detailContent").innerHTML =
      `<p class="small">${t.type === "income" ? "เงินเข้า" : "เงินออก"} · ${escapeHtml(cat.label)}</p><p class="detailAmount ${t.type}">${t.type === "income" ? "+" : "−"}${fmt(t.amount)} บาท</p><dl><dt>วันที่และเวลา</dt><dd>${thaiDate(t.date)}${t.time ? " · " + escapeHtml(t.time) + " น." : ""}</dd><dt>จำนวน</dt><dd>${fmt(t.quantity || 1)} ชิ้น</dd><dt>บันทึกช่วยจำ</dt><dd>${escapeHtml(t.note || "ไม่ได้ระบุ")}</dd><dt>เงินคงเหลือหลังรายการนี้</dt><dd>${fmt(runningBalances[t.id])} บาท</dd></dl>`;
  }
  function openDetail(id) {
    const t = currentTx.find((t) => t.id === id);
    if (!t) return;
    selectedId = id;
    renderDetail(t);
    showDialog("detailDialog");
  }
  const primaryExpense = [
    "food",
    "shopping",
    "shopee",
    "amway",
    "utility",
    "thaisombun",
  ];
  function renderCategories() {
    $("catGrid").replaceChildren();
    $("moreCatGrid").replaceChildren();
    const cats = CATEGORIES[selectedType];
    const primary =
      selectedType === "expense"
        ? primaryExpense.map((id) => cats.find((c) => c.id === id))
        : cats;
    const extra = cats.filter((c) => !primary.includes(c));
    const add = (cat, target) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "catBtn";
      b.dataset.category = cat.id;
      b.setAttribute("aria-pressed", String(selectedCat === cat.id));
      b.innerHTML = `<span class="em" aria-hidden="true">${cat.em}</span><span>${escapeHtml(cat.label)}</span>`;
      b.onclick = () => {
        selectedCat = cat.id;
        document
          .querySelectorAll(".catBtn")
          .forEach((btn) =>
            btn.setAttribute(
              "aria-pressed",
              String(btn.dataset.category === selectedCat),
            ),
          );
        hide("amwayField", selectedCat !== "amway");
        if (selectedCat !== "amway") {
          $("amwaySelect").value = "";
          $("amwayCalculation").textContent = "";
        }
      };
      $(target).appendChild(b);
    };
    primary.forEach((c) => add(c, "catGrid"));
    extra.forEach((c) => add(c, "moreCatGrid"));
    hide("moreCategoriesBtn", extra.length === 0);
    const expanded = extra.some((c) => c.id === selectedCat);
    hide("moreCatGrid", !expanded);
    $("moreCategoriesBtn").setAttribute("aria-expanded", String(expanded));
    $("moreCategoriesBtn").textContent = expanded ? "ซ่อนหมวดอื่น ๆ" : "หมวดอื่น ๆ";
    hide("amwayField", selectedCat !== "amway");
  }
  $("moreCategoriesBtn").onclick = () => {
    const expanded =
      $("moreCategoriesBtn").getAttribute("aria-expanded") !== "true";
    $("moreCategoriesBtn").setAttribute("aria-expanded", String(expanded));
    hide("moreCatGrid", !expanded);
    $("moreCategoriesBtn").textContent = expanded ? "ซ่อนหมวดอื่น ๆ" : "หมวดอื่น ๆ";
  };
  function updateSaveLabel() {
    $("saveBtn").textContent = busy
      ? "กำลังบันทึก…"
      : editingId
        ? "บันทึกการแก้ไข"
        : selectedType === "income"
          ? "บันทึกเงินเข้า"
          : "บันทึกเงินออก";
  }
  function setType(type, category = null) {
    selectedType = type;
    $("editor").dataset.flow = type;
    selectedCat = category;
    $("typeIncomeBtn").setAttribute("aria-pressed", String(type === "income"));
    $("typeExpenseBtn").setAttribute(
      "aria-pressed",
      String(type === "expense"),
    );
    $("sheetTitle").textContent = editingId
      ? "แก้ไขรายการ"
      : type === "income"
        ? "บันทึกเงินเข้า"
        : "บันทึกเงินออก";
    $("amwaySelect").value = "";
    $("amwayCalculation").textContent = "";
    hide("amwayManageForm");
    renderCategories();
    updateSaveLabel();
  }
  $("typeIncomeBtn").onclick = () => setType("income");
  $("typeExpenseBtn").onclick = () => setType("expense");
  function updateDateSummary() {
    $("dateSummary").textContent = validDate($("dateInput").value)
      ? ($("dateInput").value === todayStr() ? "วันนี้ · " : "") +
        thaiDate($("dateInput").value)
      : "เลือกวันที่";
  }
  $("dateInput").onchange = updateDateSummary;
  function openEditor(type, t = null) {
    if (busy || !db) return;
    editingId = t?.id || null;
    newTxRef = t ? null : txCollection().doc();
    $("transactionForm").reset();
    $("editorFields").disabled = false;
    hide("formError");
    hide("savingHelp");
    hide("catalogError");
    $("amountInput").value = t ? fmt(t.amount) : "";
    $("quantityInput").value = t?.quantity || 1;
    $("noteInput").value = t?.note || "";
    $("dateInput").value = t?.date || todayStr();
    $("timeInput").value = t?.time || (t ? "" : timeStr());
    $("dateDetails").open = false;
    $("extraDetails").open = !!t;
    setType(type, t?.category || null);
    updateDateSummary();
    // Existing totals stay untouched until the user explicitly selects/recalculates a catalog item.
    $("amwaySelect").value = "";
    catalogEditId = null;
    showDialog("editor");
    $("closeEditorBtn").focus();
  }
  $("addIncomeBtn").onclick = () => openEditor("income");
  $("addExpenseBtn").onclick = () => openEditor("expense");
  $("editBtn").onclick = () => {
    const t = currentTx.find((t) => t.id === selectedId);
    if (!t) return;
    $("detailDialog").close();
    openEditor(t.type, t);
  };
  $("transactionForm").onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    hide("formError");
    const amount = money($("amountInput").value),
      quantity = Number($("quantityInput").value),
      date = $("dateInput").value;
    if (!Number.isFinite(amount)) {
      errorAt("formError", "ใส่ยอดรวมมากกว่า 0 บาท และทศนิยมไม่เกิน 2 ตำแหน่ง");
      $("amountInput").focus();
      return;
    }
    if (!selectedCat) {
      errorAt("formError", "เลือกหมวดหมู่ก่อนบันทึก");
      $("catGrid").querySelector("button").focus();
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) {
      $("extraDetails").open = true;
      errorAt("formError", "จำนวนชิ้นต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 1,000,000");
      $("quantityInput").focus();
      return;
    }
    if (!validDate(date)) {
      $("dateDetails").open = true;
      errorAt("formError", "เลือกวันที่ให้ถูกต้อง");
      $("dateInput").focus();
      return;
    }
    if (editingId && !currentTx.some((t) => t.id === editingId))
      return errorAt("formError", "รายการนี้ถูกลบจากเครื่องอื่นแล้ว กรุณาปิดหน้านี้");
    const note = $("noteInput").value.trim();
    if (note.length > 2000)
      return errorAt("formError", "บันทึกช่วยจำยาวเกิน 2,000 ตัวอักษร");
    const data = {
      type: selectedType,
      category: selectedCat,
      amount,
      quantity,
      date,
      time: $("timeInput").value || null,
      note,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    const ref = editingId ? txCollection().doc(editingId) : newTxRef;
    setBusy(true);
    try {
      if (editingId) await ref.update(data);
      else {
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await ref.set(data);
      }
      $("editor").close();
      viewMonth = new Date(`${date}T12:00:00`);
      renderAll();
      showToast(
        `✓ บันทึก${data.type === "income" ? "เงินเข้า" : "เงินออก"} ${fmt(amount)} บาทแล้ว`,
      );
    } catch (err) {
      errorAt("formError", "บันทึกไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองอีกครั้ง");
      if (!$("editor").open) showDialog("editor");
      console.error("Save failed:", err.code);
    } finally {
      setBusy(false);
    }
  };

  function renderAmwaySelect() {
    const selected = $("amwaySelect").value;
    $("amwaySelect").innerHTML =
      '<option value="">เลือกสินค้า (ไม่บังคับ)</option>' +
      amwayItems
        .map(
          (i) =>
            `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)} · ${fmt(i.price)} บาท/ชิ้น</option>`,
        )
        .join("");
    if (amwayItems.some((i) => i.id === selected))
      $("amwaySelect").value = selected;
  }
  function recalculateAmway() {
    if (selectedCat !== "amway") return;
    const item = amwayItems.find((i) => i.id === $("amwaySelect").value),
      q = Number($("quantityInput").value);
    if (!item) {
      $("amwayCalculation").textContent = "";
      return;
    }
    if (!Number.isInteger(q) || q < 1) return;
    const total = (cents(item.price) * q) / 100;
    $("amountInput").value = fmt(total);
    $("noteInput").value = item.name;
    $("amwayCalculation").textContent =
      `${fmt(item.price)} บาท × ${fmt(q)} ชิ้น = ${fmt(total)} บาท`;
  }
  $("amwaySelect").onchange = () => {
    hide("amwayManageForm");
    $("extraDetails").open = !!$("amwaySelect").value;
    recalculateAmway();
  };
  $("quantityInput").oninput = recalculateAmway;
  $("amountInput").oninput = () => {
    if ($("amwaySelect").value)
      $("amwayCalculation").textContent =
        "ใช้ยอดรวมที่แก้ไขเอง หากเปลี่ยนจำนวนชิ้น ระบบจะคำนวณจากราคาสินค้าอีกครั้ง";
  };
  $("amwayManageBtn").onclick = () => {
    const item = amwayItems.find((i) => i.id === $("amwaySelect").value);
    catalogEditId = item?.id || null;
    $("amwayNameInput").value = item?.name || "";
    $("amwayPriceInput").value = item ? fmt(item.price) : "";
    hide("amwayDeleteItemBtn", !item);
    hide("catalogError");
    hide("amwayManageForm", false);
  };
  $("amwaySaveItemBtn").onclick = async () => {
    if (busy) return;
    const name = $("amwayNameInput").value.trim(),
      price = money($("amwayPriceInput").value);
    if (!name || name.length > 300 || !Number.isFinite(price))
      return errorAt("catalogError", "ใส่ชื่อสินค้าและราคาต่อชิ้นที่ถูกต้อง");
    const ref = catalogEditId
      ? catalogCollection().doc(catalogEditId)
      : catalogCollection().doc();
    catalogEditId = ref.id;
    setBusy(true);
    try {
      await ref.set({
        name,
        price,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      amwayItems = amwayItems
        .filter((i) => i.id !== ref.id)
        .concat({ id: ref.id, name, price })
        .sort((a, b) => a.name.localeCompare(b.name));
      renderAmwaySelect();
      $("amwaySelect").value = ref.id;
      $("extraDetails").open = true;
      recalculateAmway();
      hide("amwayManageForm");
      $("amwayCalculation").textContent += " · บันทึกราคาสินค้าแล้ว";
    } catch (err) {
      errorAt("catalogError", "บันทึกราคาไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  };
  function confirmDelete(kind, id, label) {
    if (busy) return;
    confirmTarget = { kind, id };
    $("confirmTitle").textContent =
      kind === "catalog" ? "ลบสินค้านี้หรือไม่?" : "ลบรายการนี้หรือไม่?";
    $("confirmDetail").textContent = label;
    hide("deleteError");
    showDialog("confirmDialog");
  }
  $("deleteBtn").onclick = () => {
    const t = currentTx.find((t) => t.id === selectedId);
    if (t)
      confirmDelete(
        "transaction",
        t.id,
        `${t.note || catInfo(t.type, t.category).label} · ${fmt(t.amount)} บาท`,
      );
  };
  $("amwayDeleteItemBtn").onclick = () => {
    const item = amwayItems.find((i) => i.id === catalogEditId);
    if (item)
      confirmDelete(
        "catalog",
        item.id,
        `${item.name} · ไม่กระทบรายการเก่าที่บันทึกไว้`,
      );
  };
  $("confirmCancelBtn").onclick = () => $("confirmDialog").close();
  $("confirmDeleteBtn").onclick = async () => {
    if (busy || !confirmTarget) return;
    const target = { ...confirmTarget };
    setBusy(true);
    try {
      await (target.kind === "catalog" ? catalogCollection() : txCollection())
        .doc(target.id)
        .delete();
      $("confirmDialog").close();
      if (target.kind === "transaction") {
        $("detailDialog").close();
        showToast("ลบรายการแล้ว");
      } else {
        hide("amwayManageForm");
        $("amwaySelect").value = "";
        $("amwayCalculation").textContent = "ลบสินค้าแล้ว · ยอดรายการนี้ยังไม่เปลี่ยน";
      }
    } catch (err) {
      errorAt("deleteError", "ลบไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setBusy(false);
    }
  };
  // Escape formulas in text fields while keeping numeric CSV columns numeric.
  const csvText = (value) =>
    /^[=+\-@\t\r]/.test(String(value)) ? "'" + value : value;
  $("exportBtn").onclick = () => {
    if (!currentTx.length) return showToast("ยังไม่มีรายการให้ดาวน์โหลด");
    const rows = [
      [
        "วันที่",
        "เวลา",
        "ประเภท",
        "หมวดหมู่",
        "จำนวนเงินรวม",
        "จำนวนชิ้น",
        "บันทึกช่วยจำ",
      ],
    ];
    [...currentTx]
      .sort(chronological)
      .forEach((t) =>
        rows.push([
          t.date,
          t.time || "",
          t.type === "income" ? "เงินเข้า" : "เงินออก",
          csvText(catInfo(t.type, t.category).label),
          t.amount,
          t.quantity || 1,
          csvText(t.note || ""),
        ]),
      );
    const csv =
      "\uFEFF" +
      rows
        .map((r) =>
          r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(","),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `สมุดเงินครอบครัว-${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  householdId = getHouseholdId();
  if (!householdId || justMinted) showSetupScreen();
  else startApp();
  if (householdId) {
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      // No authentication: the unguessable household link is the shared access capability.
      db.enablePersistence({ synchronizeTabs: true })
        .catch(() => {})
        .finally(() => {
          persistenceReady = true;
          if (!$("app").classList.contains("hidden")) startApp();
        });
    } catch (err) {
      streams.transactions.error = true;
      updateSync();
      $("loadingState").textContent =
        "โหลดระบบไม่สำเร็จ กรุณาเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่";
      $("addIncomeBtn").disabled = true;
      $("addExpenseBtn").disabled = true;
    }
  }
})();
