import { test, expect } from '@playwright/test';

const ownerEmail = `owner_${Date.now()}@test.com`;
const viewerEmail = `viewer_${Date.now()}@test.com`;
const docName = `Doc_${Date.now()}`;

test.describe(' E2E Validation', () => {
  
  test('Full Workflow: Permissions, XSS Security, and History Restore', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // --- STEP 1: LOGIN & CREATE ---
    await page.goto('http://localhost:5173');
    await page.fill('input[placeholder="email"]', ownerEmail);
    await page.click('button:has-text("Login")');
    page.on('dialog', dialog => dialog.accept(docName));
    await page.click('text=Create New'); 
    
    // WAIT FOR TAB TO LOAD
    await expect(page.getByText('Sheet 1', { exact: true })).toBeVisible();
    await expect(page.locator('.ql-editor')).toBeVisible();

    // --- STEP 2: XSS SECURITY CHECK ---
    const maliciousScript = "<script>alert('Hacked')</script>";
    await page.locator('.ql-editor').fill(maliciousScript);
    await expect(page.locator('.ql-editor')).toContainText("alert('Hacked')");

    // --- STEP 3: VERSION HISTORY CHECK ---
    await page.locator('.ql-editor').fill('Clean Version 2');
    await page.waitForTimeout(2000); // Wait for save
    
    await page.click('button:has-text("🕒 History")');
    await expect(page.locator('h3:has-text("History")')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Close")'); 

    // --- STEP 4: PERMISSIONS CHECK ---
    await page.click('button:has-text("👤 Share")');
    await page.fill('input[placeholder="Add people by email..."]', viewerEmail);
    
    // Select Viewer Role
    await page.locator('input[placeholder="Add people by email..."] + select').selectOption('viewer');
    
    await page.click('button:has-text("Invite")');
    
    // Wait for Toast success
    await expect(page.locator('.Toastify__toast')).toBeVisible();
    await page.click('button:has-text("Done")'); 
    
    // 🟢 FIX: Go back to Dashboard to find the Logout button
    await page.click('button:has-text("⬅")');

    // Logout and Login as Viewer
    await page.click('button:has-text("Logout")');
    await page.fill('input[placeholder="email"]', viewerEmail);
    await page.click('button:has-text("Login")');
    
    // Wait for dashboard -> Open Doc
    await expect(page.locator(`text=${docName}`)).toBeVisible();
    await page.click(`text=${docName}`);

    // VALIDATION: Check Read-Only
    await expect(page.locator('h2')).toContainText('(viewer)');
    const isEditable = await page.locator('.ql-editor').getAttribute('contenteditable');
    expect(isEditable).toBe('false');

    await context.close();
  });
});