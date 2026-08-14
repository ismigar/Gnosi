import { test, expect } from '@playwright/test';

test.describe('Gestió de Comptes i Visibilitat', () => {
  test('deu permetre afegir i eliminar un compte manual verificant la visibilitat del modal', async ({ page }) => {
    // 1. Navigate to the main page and open settings
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(2000);
    
    // Open settings (adjusted to the real selector)
    await page.click('[aria-label="Obrir configuració"], .icon-btn:has(svg[data-lucide="settings"])');
    
    // 2. Go to the Calendar section
    await page.click('button:has-text("Calendari")');
    
    // 3. Add a manual account
    await page.fill('input[placeholder*="correu"]', 'test-autonom@qa.com');
    await page.fill('input[placeholder*="Servidor"]', 'mail.qa.com');
    await page.fill('input[placeholder*="Contrasenya"]', 'password123');
    await page.click('button:has-text("Connectar Compte")');
    
    // Verify the addition
    await expect(page.locator('text=test-autonom@qa.com')).toBeVisible();
    
    // 4. Deletion and Z-index test
    const trashButton = page.locator('button:has(svg[data-lucide="trash-2"])').last();
    await trashButton.click();
    
    // The confirmation modal should be visible
    const confirmModal = page.locator('text=Eliminar Compte');
    await expect(confirmModal).toBeVisible();
    
    // Z-index verification (strategy: verify that it's clickable and not covered)
    await page.click('button:has-text("Confirmar")');
    
    // Final verification: the account has been deleted
    await expect(page.locator('text=test-autonom@qa.com')).not.toBeVisible();
  });
});
