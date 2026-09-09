import { syncActiveVaultCookie } from '../shared/resources/fileResourcePaths';
import { initializeVaultRouting } from '../shared/routing/vaultRouting';
import { preloadApplicationRoute } from './routePreload';
import { fetchSystemHealth } from '../shared/api/system';

type ApplicationLoader = () => Promise<{
  readonly bootstrap: (routingReady: Promise<void>) => Promise<void>;
}>;

function beginStartup(): { routingReady: Promise<void>; importsReady: Promise<void> } {
  // Images and streams inherit the same vault as the initial API requests.
  syncActiveVaultCookie();
  const routingReady = initializeVaultRouting().then(() => undefined);
  // The authentication gate and sidebar share this request. Start it while
  // routing and the React shell load; its consumers retain error handling.
  void fetchSystemHealth().catch(() => undefined);
  // Query setup and request middleware can yield through several microtasks.
  // Give them one browser turn to dispatch before Vite queues route/shell chunks.
  // This does not wait for either API response.
  const importsReady = new Promise<void>(resolve => { setTimeout(resolve, 0); })
    .then(() => { void preloadApplicationRoute(window.location.pathname); });
  return { routingReady, importsReady };
}

export async function prepareStartup(): Promise<void> {
  const { routingReady, importsReady } = beginStartup();
  await Promise.all([routingReady, importsReady]);
}

export async function startApplication(
  loadApplication: ApplicationLoader = () => import('./bootstrap'),
): Promise<void> {
  // Begin reading routing data before React DOM and the application shell have
  // finished downloading. Rendering still waits for both routing and language.
  const { routingReady, importsReady } = beginStartup();
  const application = importsReady.then(loadApplication);
  await Promise.all([
    routingReady,
    application.then(({ bootstrap }) => bootstrap(routingReady)),
  ]);
}
