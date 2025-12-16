import { logger } from "../shared/logger.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
type Handler = (req: Request) => Promise<Response | null> | Response | null;
type RouteHandler = {
	method: HttpMethod;
	path: string;
	handler: Handler;
};

class Router {
	private routes: RouteHandler[] = [];
	private middlewares: Handler[] = [];

	/**
	 * Add a route
	 */
	add(method: HttpMethod, path: string, handler: Handler): void {
		this.routes.push({ method, path, handler });
	}

	/**
	 * Add middleware (runs before routes)
	 */
	use(handler: Handler): void {
		this.middlewares.push(handler);
	}

	/**
	 * GET route
	 */
	get(path: string, handler: Handler): void {
		this.add("GET", path, handler);
	}

	/**
	 * POST route
	 */
	post(path: string, handler: Handler): void {
		this.add("POST", path, handler);
	}

	/**
	 * PUT route
	 */
	put(path: string, handler: Handler): void {
		this.add("PUT", path, handler);
	}

	/**
	 * DELETE route
	 */
	delete(path: string, handler: Handler): void {
		this.add("DELETE", path, handler);
	}

	/**
	 * PATCH route
	 */
	patch(path: string, handler: Handler): void {
		this.add("PATCH", path, handler);
	}

	/**
	 * Match a request to a route
	 */
	async handle(req: Request): Promise<Response | null> {
		const url = new URL(req.url);
		const method = req.method as HttpMethod;
		const pathname = url.pathname;

		// Run middlewares first
		for (const middleware of this.middlewares) {
			const response = await middleware(req);
			if (response && response instanceof Response) {
				return response;
			}
		}

		// Find matching route
		for (const route of this.routes) {
			if (route.method === method && this.matchPath(route.path, pathname)) {
				try {
					return await route.handler(req);
				} catch (error: any) {
					logger.error(`Error handling ${method} ${pathname}:`, error);
					return new Response(
						JSON.stringify({ error: error.message || "Internal server error" }),
						{
							status: 500,
							headers: { "Content-Type": "application/json" },
						}
					);
				}
			}
		}

		return null; // No route matched
	}

	/**
	 * Match path pattern (supports :param and * wildcards)
	 */
	private matchPath(pattern: string, path: string): boolean {
		// Exact match
		if (pattern === path) return true;

		// Convert pattern to regex
		const regexPattern = pattern
			.replace(/\*/g, ".*")
			.replace(/:[^/]+/g, "([^/]+)");
		const regex = new RegExp(`^${regexPattern}$`);

		return regex.test(path);
	}

	/**
	 * Extract params from path
	 */
	extractParams(pattern: string, path: string): Record<string, string> {
		const params: Record<string, string> = {};
		const patternParts = pattern.split("/");
		const pathParts = path.split("/");

		for (let i = 0; i < patternParts.length; i++) {
			const patternPart = patternParts[i];
			if (patternPart.startsWith(":")) {
				const paramName = patternPart.slice(1);
				params[paramName] = pathParts[i] || "";
			}
		}

		return params;
	}
}

/**
 * Helper to create JSON response with CORS headers
 */
export function json(data: any, status: number = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		},
	});
}

/**
 * Helper to parse JSON body
 */
export async function parseJson(req: Request): Promise<any> {
	const text = await req.text();
	return JSON.parse(text || "{}");
}

/**
 * Helper to get query params
 */
export function getQuery(req: Request): URLSearchParams {
	const url = new URL(req.url);
	return url.searchParams;
}

/**
 * Helper to get path params (requires router and pattern)
 */
export function getParams(router: Router, pattern: string, req: Request): Record<string, string> {
	const url = new URL(req.url);
	return router.extractParams(pattern, url.pathname);
}

export { Router };
