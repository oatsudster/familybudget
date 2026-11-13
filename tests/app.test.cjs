const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const { installFakeFirebase } = require("./fake-firebase.cjs");
const html = fs.readFileSync("index.html", "utf8");
const script = fs.readFileSync("app.js", "utf8");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const now = new Date(),
  date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-13`;
const old = new Date(now.getFullYear(), now.getMonth() - 1, 1),
  oldDate = `${old.getFullYear()}-${String(old.getMonth() + 1).padStart(2, "0")}-01`;
const records = [
  {
    id: "income-1",
    type: "income",
    category: "salary",
    amount: 1000,
    date,
    time: "09:00",
    note: "เงินเดือน",
  },
  {
    id: "expense-a",
    type: "expense",
    category: "food",
    amount: 100,
    date,
    time: "10:00",
    note: "อาหาร",
  },
  {
    id: "expense-b",
    type: "expense",
    category: "food",
    amount: 50,
    date,
    time: "10:00",
    note: "อาหารอีกมื้อ",
  },
  {
    id: "older",
    type: "expense",
    category: "food",
    amount: 10,
    date: oldDate,
    time: "10:00",
  },
];
async function setup(t, options = {}) {
  const dom = new JSDOM(html, {
    url:
      options.url ||
      "https://example.test/?h=11111111-2222-4333-8444-555555555555",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  const fake = installFakeFirebase(w, {
    transactions: records,
    amwayItems: [{ id: "product-a", name: "สินค้าเดิม", price: 125 }],
  });
  w.console.error = () => {};
  w.eval(script);
  await pause(5);
  t.after(() => w.close());
  return { w, fake, $: (id) => w.document.getElementById(id) };
}
function fill(env, amount = "120") {
  env.$("addExpenseBtn").click();
  env.$("amountInput").value = amount;
  env.w.document.querySelector('[data-category="food"]').click();
}
function submit(env) {
  env
    .$("transactionForm")
    .dispatchEvent(new env.w.Event("submit", { cancelable: true }));
}
test("link opens without an auth SDK; current balance and past-month totals stay distinct", async (t) => {
  const e = await setup(t);
  assert.equal(e.$("app").classList.contains("hidden"), false);
  assert.equal(e.w.firebase.auth, undefined);
  assert.equal(e.$("balanceAmount").textContent, "840");
  e.$("prevMonth").click();
  assert.equal(e.$("monthExpense").textContent, "−10");
  assert.equal(e.$("balanceAmount").textContent, "840");
  assert.match(e.$("netRow").textContent, /เดือนที่เลือก/);
});
test("double submission has exactly one stable document; failure retains input and retry ID", async (t) => {
  const e = await setup(t);
  fill(e, "1,234.50");
  e.fake.failNext = true;
  submit(e);
  submit(e);
  assert.equal(e.fake.writes.length, 1);
  assert.equal(e.$("saveBtn").disabled, true);
  await pause(45);
  assert.equal(e.$("editor").open, true);
  assert.equal(e.$("amountInput").value, "1,234.50");
  assert.equal(e.$("saveBtn").disabled, false);
  submit(e);
  await pause(45);
  assert.equal(e.fake.writes.length, 2);
  assert.equal(e.fake.writes[0].id, e.fake.writes[1].id);
  assert.equal(e.$("editor").open, false);
  assert.equal(e.fake.writes[1].value.amount, 1234.5);
});
test("invalid amount/category/quantity are blocked, backdated record selects its saved month", async (t) => {
  const e = await setup(t);
  fill(e, "1,2");
  submit(e);
  assert.equal(e.fake.writes.length, 0);
  e.$("amountInput").value = "12.345";
  submit(e);
  assert.equal(e.fake.writes.length, 0);
  e.$("amountInput").value = "120";
  e.$("quantityInput").value = "1.5";
  submit(e);
  assert.equal(e.fake.writes.length, 0);
  e.$("quantityInput").value = "2";
  e.$("dateInput").value = oldDate;
  submit(e);
  await pause(45);
  assert.equal(e.fake.writes[0].value.amount, 120);
  assert.equal(e.$("monthExpense").textContent, "−130");
});
test("category order remains fixed and accessible; extra category can be edited", async (t) => {
  const e = await setup(t);
  fill(e);
  const names = [...e.$("catGrid").children].map((b) => b.dataset.category);
  assert.deepEqual(names, [
    "food",
    "shopping",
    "shopee",
    "amway",
    "utility",
    "thaisombun",
  ]);
  assert.equal(e.$("catGrid").firstElementChild.tagName, "BUTTON");
  e.$("moreCategoriesBtn").click();
  e.w.document.querySelector('[data-category="home"]').click();
  submit(e);
  await pause(45);
  const id = e.fake.writes[0].id;
  e.w.document.querySelector(`[data-transaction="${id}"]`).click();
  e.$("editBtn").click();
  assert.equal(e.$("moreCatGrid").classList.contains("hidden"), false);
  assert.equal(
    e.w.document
      .querySelector('[data-category="home"]')
      .getAttribute("aria-pressed"),
    "true",
  );
});
test("Amway calculation is explicit; existing total is preserved and other categories do not multiply", async (t) => {
  const e = await setup(t);
  fill(e);
  e.w.document.querySelector('[data-category="amway"]').click();
  e.$("amwaySelect").value = "product-a";
  e.$("amwaySelect").dispatchEvent(new e.w.Event("change"));
  e.$("quantityInput").value = 3;
  e.$("quantityInput").dispatchEvent(new e.w.Event("input"));
  assert.equal(e.$("amountInput").value, "375");
  assert.match(e.$("amwayCalculation").textContent, /125 บาท × 3 ชิ้น = 375 บาท/);
  e.$("amountInput").value = "350";
  submit(e);
  await pause(45);
  const id = e.fake.writes[0].id;
  e.w.document.querySelector(`[data-transaction="${id}"]`).click();
  e.$("editBtn").click();
  assert.equal(e.$("amountInput").value, "350");
  e.w.document.querySelector('[data-category="food"]').click();
  e.$("quantityInput").value = 4;
  e.$("quantityInput").dispatchEvent(new e.w.Event("input"));
  assert.equal(e.$("amountInput").value, "350");
});
test("snapshot metadata and offline/pending states never claim successful sync early", async (t) => {
  const e = await setup(t);
  assert.equal(e.$("syncText").textContent, "✓ บันทึกครบแล้ว");
  e.fake.fromCache = true;
  e.fake.emit();
  assert.match(e.$("syncText").textContent, /ตรวจสอบ/);
  Object.defineProperty(e.w.navigator, "onLine", {
    value: false,
    configurable: true,
  });
  e.w.dispatchEvent(new e.w.Event("offline"));
  assert.match(e.$("syncText").textContent, /ออฟไลน์/);
  fill(e);
  submit(e);
  assert.match(e.$("syncText").textContent, /รออินเทอร์เน็ต/);
  e.$("cancelBtn").click();
  assert.equal(e.$("addExpenseBtn").disabled, true);
  await pause(45);
  Object.defineProperty(e.w.navigator, "onLine", {
    value: true,
    configurable: true,
  });
  e.fake.fromCache = false;
  e.fake.emit();
  assert.equal(e.$("syncText").textContent, "✓ บันทึกครบแล้ว");
});
test("details use deterministic running balances for transactions with identical time; delete needs confirmation", async (t) => {
  const e = await setup(t);
  e.w.document.querySelector('[data-transaction="expense-b"]').click();
  assert.match(e.$("detailContent").textContent, /840 บาท/);
  e.$("deleteBtn").click();
  assert.equal(e.fake.writes.length, 0);
  e.$("confirmCancelBtn").click();
  assert.equal(e.fake.writes.length, 0);
  e.$("deleteBtn").click();
  e.$("confirmDeleteBtn").click();
  e.$("confirmDeleteBtn").click();
  await pause(45);
  assert.equal(e.fake.writes.length, 1);
  assert.equal(e.fake.data.transactions.has("expense-b"), false);
});
test("invalid links do not open or silently create another household", async (t) => {
  const e = await setup(t, { url: "https://example.test/?h=bad/path" });
  assert.equal(e.$("app").classList.contains("hidden"), true);
  assert.equal(e.$("setupScreen").classList.contains("hidden"), false);
  assert.equal(e.fake.writes.length, 0);
});
test("untrusted notes render as text; all visible inputs have labels", async (t) => {
  const e = await setup(t);
  e.fake.data.transactions.get("expense-a").note =
    "<img src=x onerror=alert(1)>";
  e.fake.emit();
  assert.equal(e.$("txList").querySelector("img"), null);
  for (const input of e.w.document.querySelectorAll("input,select,textarea"))
    assert.ok(e.w.document.querySelector(`label[for="${input.id}"]`), input.id);
});
