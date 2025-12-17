/**
 * Adapter to run Express app with Bun.serve()
 * Converts Bun Request/Response to Express-compatible format
 */

export function createExpressAdapter(expressApp: any) {
	return async (req: Request): Promise<Response> => {
		return new Promise((resolve) => {
			// Convert Web API Request to Express-compatible format
			const url = new URL(req.url);

			// Create headers object that Express expects
			const headersObj: Record<string, string> = {};
			req.headers.forEach((value, key) => {
				headersObj[key] = value;
			});

			const expressReq = {
				method: req.method,
				url: url.pathname + url.search,
				originalUrl: url.pathname + url.search,
				baseUrl: "",
				path: url.pathname,
				query: Object.fromEntries(url.searchParams),
				params: {},
				headers: headersObj,
				rawHeaders: Array.from(req.headers.entries()).flat(),
				httpVersion: "1.1",
				protocol: url.protocol.slice(0, -1), // Remove trailing ':'
				secure: url.protocol === "https:",
				hostname: url.hostname,
				ip: req.headers.get("x-forwarded-for") || url.hostname,
				ips: [],
				subdomains: [],
				xhr: req.headers.get("x-requested-with") === "XMLHttpRequest",
				body: undefined as any,
				// Express middleware expects these methods
				get: function (name: string) {
					return this.headers[name.toLowerCase()];
				},
				header: function (name: string) {
					return this.headers[name.toLowerCase()];
				},
			} as any;

			// Create Express-compatible response
			let responseSent = false;
			const expressRes = {
				statusCode: 200,
				headers: {} as Record<string, string>,
				body: "",
				locals: {},
				setHeader: function (name: string, value: string | number | string[]) {
					const headerValue = Array.isArray(value) ? value.join(", ") : String(value);
					this.headers[name.toLowerCase()] = headerValue;
					return this;
				},
				getHeader: function (name: string) {
					return this.headers[name.toLowerCase()];
				},
				removeHeader: function (name: string) {
					delete this.headers[name.toLowerCase()];
				},
				writeHead: function (status: number, headers?: Record<string, string | number>) {
					this.statusCode = status;
					if (headers) {
						Object.entries(headers).forEach(([k, v]) => {
							this.headers[k.toLowerCase()] = String(v);
						});
					}
					return this;
				},
				status: function (code: number) {
					this.statusCode = code;
					return this;
				},
				write: function (chunk: string | Buffer) {
					if (!responseSent) {
						this.body += chunk.toString();
					}
					return this;
				},
				end: function (chunk?: string | Buffer) {
					if (responseSent) return this;
					responseSent = true;

					if (chunk) {
						this.body += chunk.toString();
					}

					// Convert to Web API Response
					const responseHeaders = new Headers();
					Object.entries(this.headers as Record<string, string>).forEach(([k, v]: [string, string]) => {
						responseHeaders.set(k, v);
					});

					resolve(
						new Response(this.body, {
							status: this.statusCode,
							headers: responseHeaders,
						})
					);
					return this;
				},
				json: function (data: any) {
					if (responseSent) return this;
					this.setHeader("content-type", "application/json");
					this.body = JSON.stringify(data);
					this.end();
					return this;
				},
				send: function (data?: string | Buffer | number) {
					if (responseSent) return this;
					if (data !== undefined) {
						this.body = data.toString();
					}
					this.end();
					return this;
				},
				sendFile: function (filePath: string, options?: any, callback?: any) {
					if (responseSent) return this;
					// Use Bun's file API
					// @ts-ignore - Bun global is available at runtime
					const file = Bun.file(filePath);
					file.text()
						.then((content: string) => {
							// Set content type based on file extension
							const ext = filePath.split(".").pop()?.toLowerCase();
							const mimeTypes: Record<string, string> = {
								html: "text/html",
								js: "application/javascript",
								css: "text/css",
								json: "application/json",
								png: "image/png",
								jpg: "image/jpeg",
								jpeg: "image/jpeg",
								gif: "image/gif",
								svg: "image/svg+xml",
							};
							if (ext && mimeTypes[ext]) {
								this.setHeader("content-type", mimeTypes[ext]);
							}
							this.body = content;
							this.end();
							if (callback) callback();
						})
						.catch(() => {
							this.statusCode = 404;
							this.end();
							if (callback) callback(new Error("File not found"));
						});
					return this;
				},
				redirect: function (url: string) {
					if (responseSent) return this;
					this.statusCode = 302;
					this.setHeader("location", url);
					this.end();
					return this;
				},
			} as any;

			// Handle body parsing for POST/PUT requests
			if (req.body && (req.method === "POST" || req.method === "PUT" || req.method === "PATCH")) {
				req.text()
					.then((bodyText) => {
						expressReq.body = bodyText;
						expressApp(expressReq, expressRes);
					})
					.catch((error) => {
						resolve(new Response("Error parsing request body", { status: 400 }));
					});
			} else {
				expressApp(expressReq, expressRes);
			}
		});
	};
}

