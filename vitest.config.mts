import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				miniflare: {
					bindings: {
						CACHE_TTL: '{}',
						BROWSER_TTL: '3600',
						BLOCK_MODE: 'true',
						DEBUG: 'true',
					},
				},
			},
		},
	},
});
