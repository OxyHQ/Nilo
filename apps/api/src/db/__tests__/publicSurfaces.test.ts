import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

describe('the checked-in public surfaces describe routes that exist', () => {
  it('has no implicit production API origin', () => {
    const config = readFileSync(resolve(REPOSITORY_ROOT, 'apps/app/lib/config.ts'), 'utf8');
    const validator = readFileSync(resolve(REPOSITORY_ROOT, 'apps/app/lib/api-origin.ts'), 'utf8');
    const deploy = readFileSync(resolve(REPOSITORY_ROOT, '.github/workflows/deploy.yml'), 'utf8');

    expect(config).toContain("process.env.NODE_ENV === 'production'");
    expect(config).not.toContain('api.nilo.so');
    expect(validator).toContain('EXPO_PUBLIC_API_URL is required');
    expect(validator).not.toContain('api.nilo.so');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts the literal GitHub Actions expression in the workflow text
    expect(deploy).toContain('EXPO_PUBLIC_API_URL: ${{ vars.NILO_API_URL }}');
    expect(deploy).toContain('bun run build:production');
    expect(deploy).not.toContain('api.nilo.so');
    expect(
      readFileSync(resolve(REPOSITORY_ROOT, 'apps/api/src/routes/share-links.ts'), 'utf8'),
    ).not.toContain("|| 'https://nilo.so'");
  });

  it('binds notification sockets to the server-validated Oxy session', () => {
    const serverSocket = readFileSync(resolve(REPOSITORY_ROOT, 'apps/api/src/socket.ts'), 'utf8');
    // The app's one shared socket authenticates with the token the root
    // layout hands the API client: the Oxy session's.
    const clientSocket = readFileSync(
      resolve(REPOSITORY_ROOT, 'apps/app/lib/realtime/socket.ts'),
      'utf8',
    );
    const rootLayout = readFileSync(resolve(REPOSITORY_ROOT, 'apps/app/app/_layout.tsx'), 'utf8');
    const notificationSetup = readFileSync(
      resolve(REPOSITORY_ROOT, 'apps/app/lib/hooks/use-notification-setup.ts'),
      'utf8',
    );

    expect(serverSocket).toContain('io.use(oxyClient.middleware.socket())');
    expect(serverSocket).toContain('socket.data.userId');
    expect(serverSocket).not.toContain("socket.on('subscribe-notifications'");
    expect(clientSocket).toContain('const token = currentAccessToken();');
    expect(rootLayout).toContain('bindApiClient(oxyServices)');
    expect(rootLayout).toContain('releaseApiClient(oxyServices)');
    expect(clientSocket).toContain('onApiSessionContextChange');
    expect(notificationSetup).toContain('acquireSocket()');
    expect(notificationSetup).not.toContain("socket.emit('subscribe-notifications'");
  });

  it('generates a sitemap containing only Nilo routes that are present', () => {
    const generator = readFileSync(
      resolve(REPOSITORY_ROOT, 'apps/app/scripts/generate-sitemap.ts'),
      'utf8',
    );
    const generatedRoutes = [...generator.matchAll(/\bloc:\s*['"]([^'"]+)['"]/g)].map(
      (match) => match[1],
    );
    const sitemap = readFileSync(resolve(REPOSITORY_ROOT, 'apps/app/public/sitemap.xml'), 'utf8');
    const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

    expect(generatedRoutes).toEqual(['/']);
    expect(sitemapUrls).toEqual(['https://nilo.so/']);
  });

  it('does not advertise Alia or nonexistent Nilo pages in robots.txt', () => {
    const robots = readFileSync(resolve(REPOSITORY_ROOT, 'apps/app/public/robots.txt'), 'utf8');
    const sitemapLines = robots.split('\n').filter((line) => line.startsWith('Sitemap:'));

    expect(robots).not.toContain('alia.onl');
    expect(robots).not.toContain('/developers/');
    expect(sitemapLines).toEqual(['Sitemap: https://nilo.so/sitemap.xml']);
  });

  it('does not mount or advertise the catch-all webhook router that always returned 404', () => {
    const indexSource = readFileSync(resolve(REPOSITORY_ROOT, 'apps/api/src/index.ts'), 'utf8');

    expect(existsSync(resolve(REPOSITORY_ROOT, 'apps/api/src/routes/webhooks.ts'))).toBe(false);
    expect(indexSource).not.toContain('./routes/webhooks.js');
    expect(indexSource).not.toMatch(/app\.use\(['"]\/webhooks['"]/);
  });

  it('mounts the workspace API without retired inference route groups', () => {
    const indexSource = readFileSync(resolve(REPOSITORY_ROOT, 'apps/api/src/index.ts'), 'utf8');

    expect(indexSource).toContain("app.use('/workspaces', workspacesRouter)");
    expect(indexSource).toContain("app.use('/pages', pagesRouter)");
    expect(indexSource).toContain("app.use('/databases', databasesRouter)");
    expect(indexSource).not.toMatch(
      /app\.use\(['"]\/(?:v1|clarity|conversations|billing|credits|models|analytics|internal)/u,
    );
  });
});
