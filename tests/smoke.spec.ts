import { test, expect } from "@playwright/test";

test("app loads and shows login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Llámenos/i);
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /secret key/i })).toBeVisible();
});

test("rejects invalid nsec", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: /secret key/i }).fill("invalid-key");
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page.getByText(/invalid/i)).toBeVisible();
});
