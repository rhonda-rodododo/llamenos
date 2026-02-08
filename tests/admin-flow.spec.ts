import { test, expect, type Page } from "@playwright/test";

// Admin nsec matching the ADMIN_PUBKEY in .dev.vars
const ADMIN_NSEC =
  "nsec174zsa94n3e7t0ugfldh9tgkkzmaxhalr78uxt9phjq3mmn6d6xas5jdffh";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: /secret key/i }).fill(ADMIN_NSEC);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

test.describe("Admin flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("login shows dashboard with admin nav", async ({ page }) => {
    await expect(page.getByText("Admin")).toBeVisible();
    await expect(page.getByRole("link", { name: "Volunteers" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Shifts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ban List" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Call History" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Audit Log" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("volunteer CRUD", async ({ page }) => {
    await page.getByRole("link", { name: "Volunteers" }).click();
    await expect(page.getByRole("heading", { name: "Volunteers" })).toBeVisible();

    // Add volunteer
    await page.getByRole("button", { name: /add volunteer/i }).click();
    // Use the input fields directly (labels aren't connected via htmlFor)
    const form = page.locator("form");
    await form.locator("input").first().fill("Test Volunteer");
    await form.locator('input[type="tel"]').fill("+15551112222");
    await page.getByRole("button", { name: /save/i }).click();

    // Should show the generated nsec
    await expect(page.getByText(/nsec1/)).toBeVisible();

    // Volunteer should appear in the table
    await expect(page.getByText("Test Volunteer")).toBeVisible();
    await expect(page.getByText("+15551112222")).toBeVisible();

    // Delete the volunteer — click delete, then confirm in the dialog
    const row = page.getByRole("row").filter({ hasText: "Test Volunteer" });
    await row.getByRole("button", { name: /delete/i }).click();
    // ConfirmDialog shows — click Confirm
    await page.getByRole("button", { name: /confirm/i }).click();

    // Volunteer should be removed
    await expect(page.getByText("Test Volunteer")).not.toBeVisible();
  });

  test("shift creation", async ({ page }) => {
    await page.getByRole("link", { name: "Shifts" }).click();
    await expect(
      page.getByRole("heading", { name: /shift schedule/i })
    ).toBeVisible();

    await page.getByRole("button", { name: /create shift/i }).click();
    const form = page.locator("form");
    await form.locator("input").first().fill("E2E Test Shift");
    await page.getByRole("button", { name: /save/i }).click();

    await expect(page.getByText("E2E Test Shift")).toBeVisible();
  });

  test("ban list management", async ({ page }) => {
    await page.getByRole("link", { name: "Ban List" }).click();
    await expect(
      page.getByRole("heading", { name: /ban list/i })
    ).toBeVisible();

    await page.getByRole("button", { name: /ban number/i }).click();
    const form = page.locator("form");
    await form.locator('input[type="tel"]').fill("+15559998888");
    await form.locator("input").last().fill("E2E test ban");
    await page.getByRole("button", { name: /save/i }).click();

    await expect(page.getByText("+15559998888")).toBeVisible();
    await expect(page.getByText("E2E test ban")).toBeVisible();
  });

  test("phone validation rejects bad numbers", async ({ page }) => {
    await page.getByRole("link", { name: "Volunteers" }).click();
    await page.getByRole("button", { name: /add volunteer/i }).click();

    const form = page.locator("form");
    await form.locator("input").first().fill("Bad Phone");
    await form.locator('input[type="tel"]').fill("not-a-number");
    await page.getByRole("button", { name: /save/i }).click();

    // Should show validation error toast
    await expect(page.getByText(/invalid phone/i)).toBeVisible();
  });

  test("audit log shows entries", async ({ page }) => {
    await page.getByRole("link", { name: "Audit Log" }).click();
    await expect(
      page.getByRole("heading", { name: /audit log/i })
    ).toBeVisible();

    // Should have entries from previous tests and manual testing
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("settings page loads with all sections", async ({ page }) => {
    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    // Use heading-level selectors for section headers
    await expect(
      page.getByRole("heading", { name: "Transcription" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Spam Mitigation" })
    ).toBeVisible();
    await expect(page.getByText("Voice CAPTCHA")).toBeVisible();
    await expect(page.getByText("Rate Limiting")).toBeVisible();
  });

  test("call history page loads", async ({ page }) => {
    await page.getByRole("link", { name: "Call History" }).click();
    await expect(
      page.getByRole("heading", { name: /call history/i })
    ).toBeVisible();
  });

  test("notes page loads", async ({ page }) => {
    await page.getByRole("link", { name: "Notes" }).click();
    await expect(
      page.getByRole("heading", { name: /call notes/i })
    ).toBeVisible();
    await expect(page.getByText(/encrypted end-to-end/i)).toBeVisible();
  });

  test("language switching works", async ({ page }) => {
    await page.getByRole("button", { name: "ES" }).click();
    await expect(page.getByRole("heading", { name: "Panel" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Notas" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /cerrar sesión/i })
    ).toBeVisible();

    // Switch back
    await page.getByRole("button", { name: "EN" }).click();
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
  });

  test("logout works", async ({ page }) => {
    await page.getByRole("button", { name: /log out/i }).click();
    await expect(
      page.getByRole("heading", { name: /sign in/i })
    ).toBeVisible();
  });
});
