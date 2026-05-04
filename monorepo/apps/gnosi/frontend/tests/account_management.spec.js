import { test, expect } from '@playwright/test';

test.describe('Gestió de Comptes i Visibilitat', () => {
  test('deu permetre afegir i eliminar un compte manual verificant la visibilitat del modal', async ({ page }) => {
    // 1. Navegar a la pàgina principal i obrir configuració
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(2000);
    
    // Obsequir configuració (ajustat al selector real)
    await page.click('[aria-label="Obrir configuració"], .icon-btn:has(svg[data-lucide="settings"])');
    
    // 2. Anar a la secció de Calendari
    await page.click('button:has-text("Calendari")');
    
    // 3. Afegir un compte manual
    await page.fill('input[placeholder*="correu"]', 'test-autonom@qa.com');
    await page.fill('input[placeholder*="Servidor"]', 'mail.qa.com');
    await page.fill('input[placeholder*="Contrasenya"]', 'password123');
    await page.click('button:has-text("Connectar Compte")');
    
    // Verificació d'afegit
    await expect(page.locator('text=test-autonom@qa.com')).toBeVisible();
    
    // 4. Test d'eliminació i Z-index
    const trashButton = page.locator('button:has(svg[data-lucide="trash-2"])').last();
    await trashButton.click();
    
    // El modal de confirmació hauria de ser visible
    const confirmModal = page.locator('text=Eliminar Compte');
    await expect(confirmModal).toBeVisible();
    
    // Verificació de Z-index (estratègia: verificar que és clickable i no tapat)
    await page.click('button:has-text("Confirmar")');
    
    // Verificació final: el compte s'ha esborrat
    await expect(page.locator('text=test-autonom@qa.com')).not.toBeVisible();
  });
});
