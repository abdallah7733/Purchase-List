// Smoke test: load the app at iPhone size, set a quantity, confirm the list.
// Supabase is fully faked, so no real data is read or written.
const { test, expect } = require("@playwright/test");
const path = require("path");

const CATEGORIES = [
  { id: 1, name: "Dairy", sub: "Fridge", hue: "#0071E3", sort: 1 },
  { id: 2, name: "Bakery", sub: null, hue: "#FF9500", sort: 2 }
];
const ITEMS = [
  { id: "milk", name: "Milk", category_id: 1, default_unit: "L", sort: 1 },
  { id: "eggs", name: "Eggs", category_id: 1, default_unit: "pcs", sort: 2 },
  { id: "bread", name: "Bread", category_id: 2, default_unit: "pcs", sort: 1 }
];
// Local copy of supabase-js, served in place of the CDN script. Keep its version in step with index.html.
const SUPABASE_JS = path.join(__dirname, "..", "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js");

async function fakeSupabase(page){
  const saved = [];
  await page.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@/, r => r.fulfill({ path: SUPABASE_JS, contentType: "text/javascript" }));
  // Every Supabase request is answered here; nothing reaches the real project.
  await page.route(/^https:\/\/[^/]*\.supabase\.co\//, async r => {
    const req = r.request(), url = new URL(req.url()), json = body => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/rest/v1/purchases_categories") return json(CATEGORIES);
    if (url.pathname === "/rest/v1/purchases_items") return json(ITEMS);
    if (url.pathname === "/rest/v1/purchases_sessions"){
      if (req.method() === "GET") return json(saved.map(s => ({ day: s.day, items: s.items })));
      if (req.method() === "POST"){ saved.push(req.postDataJSON()); return r.fulfill({ status: 201, body: "" }); }
    }
    return json([]);
  });
  // Live sync socket: accept it and stay silent.
  await page.routeWebSocket(/supabase\.co/, () => {});
  return saved;
}

test("pick a quantity and confirm today's list", async ({ page }) => {
  const saved = await fakeSupabase(page);
  await page.goto("/");

  await expect(page.locator("#saveState")).toHaveText("Synced");
  await expect(page.locator("#totalItems")).toHaveText("3");
  await expect(page.locator("#confirmBar")).not.toHaveClass(/\bshow\b/);

  // Open Dairy, open Milk, type 2 (litres by default).
  await page.getByRole("button", { name: /Dairy/ }).click();
  const milk = page.locator('.item[data-id="milk"]');
  await milk.locator(".item-row").click();
  await milk.getByRole("button", { name: "Type amount" }).click();
  await milk.getByLabel("Type amount for Milk").fill("2");
  await milk.getByLabel("Type amount for Milk").press("Enter");

  await expect(milk.locator(".badge")).toHaveText("2 L");
  await expect(page.locator("#filledCount")).toHaveText("1 of 3");
  await expect(page.locator("#confirmCount")).toHaveText("1 item picked");

  // Confirm saves today's list.
  const confirm = page.locator("#confirmBtn");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator("#saveState")).toHaveText("Saved");
  await expect(confirm).toHaveText("Saved");

  expect(saved).toHaveLength(1);
  expect(saved[0].items).toEqual([{ item_id: "milk", qty: 2, unit: "L" }]);
  expect(saved[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  // History shows the saved day.
  await expect(page.locator("#histMeta")).toHaveText("1 day saved.");
  await expect(page.locator("#histBody")).toContainText("Milk");
  await expect(page.locator("#histBody")).toContainText("2 L");
});
