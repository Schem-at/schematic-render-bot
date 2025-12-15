// synthase_scripts.ts - TypeScript-fixed child process solution
import { Router } from "express";
import { spawn, ChildProcess } from "child_process";
import { join } from "path";

const router = Router();

// Type definitions for child process communication
interface ChildProcessMessage {
	success: boolean;
	result?: {
		hasSchematic?: boolean;
		schematic?: string | Buffer;
		[key: string]: any;
	};
	error?: {
		message: string;
		name: string;
	};
}

interface ExecutionResult {
	hasSchematic?: boolean;
	schematic?: Buffer;
	[key: string]: any;
}

/**
 * Execute synthase code in a killable child process
 */
async function executeWithHardTimeout(
	scriptContent: string,
	inputs: Record<string, any>,
	timeoutMs: number = 5000
): Promise<ExecutionResult> {
	return new Promise((resolve, reject) => {
		// Try both src and dist locations for the child script
		const possiblePaths = [
			join(process.cwd(), "src", "child-executor.mjs"),
			join(process.cwd(), "dist", "child-executor.mjs"),
			join(process.cwd(), "child-executor.mjs"),
		];

		let childScriptPath = "";
		const fs = require("fs");

		for (const path of possiblePaths) {
			if (fs.existsSync(path)) {
				childScriptPath = path;
				console.log(`✅ Parent: Found child script at: ${childScriptPath}`);
				break;
			}
		}

		if (!childScriptPath) {
			console.error(
				`❌ Parent: Child script not found in any of these locations:`
			);
			possiblePaths.forEach((path) => console.error(`   - ${path}`));
			reject(
				new Error(
					`Child script not found. Please ensure child-executor.mjs exists in src/ directory`
				)
			);
			return;
		}

		console.log(`🔧 Parent: Using child script at: ${childScriptPath}`);
		console.log(`📁 Parent: Working directory: ${process.cwd()}`);

		// Spawn child process using the permanent script
		const child: ChildProcess = spawn(
			"bun",
			[
				childScriptPath, // Remove 'run' - just execute the file directly
				scriptContent,
				JSON.stringify(inputs),
				(timeoutMs - 500).toString(), // Give child slightly less time than parent
			],
			{
				stdio: ["pipe", "pipe", "pipe", "ipc"],
				cwd: process.cwd(),
			}
		);

		// Test route with longer timeout for debugging
		router.post("/long-synth", async (req, res) => {
			const startTime = Date.now();

			const prefix = `
export const io = {
  inputs: {},
  outputs: {
    message: { type: 'string' },
    schematic: { type: 'object' }
  }
};
export default async function({ }, { Schematic }) {`;

			const code = req.body;
			const executableCode = prefix + code + `}`;

			console.log(`🚀 Executing with 15s hard timeout (child process)...`);

			try {
				const result = await executeWithHardTimeout(executableCode, {}, 15000); // 15 second timeout

				const executionTime = Date.now() - startTime;
				console.log(`✅ Long execution completed in ${executionTime}ms`);

				if (result.hasSchematic && Buffer.isBuffer(result.schematic)) {
					res.set("Content-Type", "application/octet-stream");
					res.send(result.schematic);
					return;
				}

				res.json({
					executionResult: result,
					executionTime,
					protection: "SIGKILL-15s",
				});
			} catch (error) {
				const executionTime = Date.now() - startTime;
				const errorMessage =
					error instanceof Error ? error.message : "Unknown error";
				console.error(
					`❌ Long execution failed after ${executionTime}ms: ${errorMessage}`
				);

				res.status(408).json({
					error: "Long execution failed",
					message: errorMessage,
					type: "long_timeout",
					executionTime,
				});
			}
		});

		let isResolved = false;

		// HARD TIMEOUT - will forcibly kill the process
		const killTimer = setTimeout(() => {
			if (!isResolved) {
				isResolved = true;
				console.log(
					`❌ KILLING child process after ${timeoutMs}ms (no response received)`
				);

				// SIGKILL cannot be caught - this WILL stop the process
				child.kill("SIGKILL");

				reject(new Error(`Execution forcibly terminated after ${timeoutMs}ms`));
			}
		}, timeoutMs + 200); // Add small buffer for IPC transmission

		// Handle successful communication
		child.on("message", (message) => {
			console.log(`📥 Parent: Received message from child`);
			const typedMessage = message as ChildProcessMessage;

			if (!isResolved) {
				isResolved = true;
				clearTimeout(killTimer);
				console.log(`✅ Parent: Processing child result...`);

				if (typedMessage.success && typedMessage.result) {
					// Reconstruct schematic if needed
					if (
						typedMessage.result.hasSchematic &&
						typedMessage.result.schematic
					) {
						console.log(`🔄 Parent: Reconstructing schematic from base64...`);
						try {
							typedMessage.result.schematic = Buffer.from(
								typedMessage.result.schematic as string,
								"base64"
							);
							console.log(`✅ Parent: Schematic reconstructed successfully`);
						} catch (err) {
							console.error(`❌ Parent: Failed to reconstruct schematic:`, err);
							reject(
								new Error("Failed to reconstruct schematic from child process")
							);
							return;
						}
					}
					console.log(`🎉 Parent: Resolving with result`);
					resolve(typedMessage.result as any);
				} else if (typedMessage.error) {
					console.log(
						`❌ Parent: Child reported error: ${typedMessage.error.message}`
					);
					reject(new Error(typedMessage.error.message));
				} else {
					console.log(`❌ Parent: Child sent invalid message structure`);
					reject(new Error("Unknown error in child process"));
				}
			} else {
				console.log(`⚠️  Parent: Received message after already resolved`);
			}
		});

		// Handle process termination
		child.on("exit", (code, signal) => {
			console.log(
				`🏁 Parent: Child process exited with code ${code}, signal ${signal}`
			);

			if (!isResolved) {
				isResolved = true;
				clearTimeout(killTimer);

				if (signal === "SIGKILL") {
					console.log(`🔪 Parent: Process was killed by SIGKILL`);
					reject(new Error(`Process killed after ${timeoutMs}ms timeout`));
				} else if (code !== 0) {
					console.log(`💥 Parent: Process exited with error code ${code}`);
					reject(new Error(`Process exited with code ${code}`));
				} else {
					console.log(
						`👻 Parent: Process exited cleanly but no message received`
					);
					reject(new Error("Process exited without sending result"));
				}
			} else {
				console.log(`✅ Parent: Process exited after successful communication`);
			}
		});

		// Handle spawn errors
		child.on("error", (error) => {
			if (!isResolved) {
				isResolved = true;
				clearTimeout(killTimer);
				reject(new Error(`Failed to spawn process: ${error.message}`));
			}
		});

		// Debug output - with null checks
		if (child.stdout) {
			child.stdout.on("data", (data) => {
				const output = data.toString().trim();
				console.log(`📤 Child stdout: ${output}`);
			});
		}

		if (child.stderr) {
			child.stderr.on("data", (data) => {
				const output = data.toString().trim();
				console.error(`📤 Child stderr: ${output}`);
			});
		}
	});
}

router.get("/test", (req, res) => {
	res.json({
		response: "Hello world",
		protection: "Child process + SIGKILL",
	});
});

router.post("/basic-synth", async (req, res) => {
	const startTime = Date.now();

	const prefix = `
export const io = {
  inputs: {},
  outputs: {
    message: { type: 'string' },
    schematic: { type: 'object' }
  }
};
export default async function({ }, { Schematic }) {`;

	const code = req.body;
	const executableCode = prefix + code + `}`;

	console.log(`🚀 Executing with 5s hard timeout (child process)...`);
	console.log(`📝 Code length: ${executableCode.length} characters`);

	try {
		const result = await executeWithHardTimeout(executableCode, {}, 5000);

		const executionTime = Date.now() - startTime;
		console.log(`✅ Completed in ${executionTime}ms`);

		// Send schematic as binary if present
		if (result.hasSchematic && Buffer.isBuffer(result.schematic)) {
			res.set("Content-Type", "application/octet-stream");
			res.send(result.schematic);
			return;
		}

		res.json({
			executionResult: result,
			executionTime,
			protection: "SIGKILL",
		});
	} catch (error) {
		const executionTime = Date.now() - startTime;
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		console.error(`❌ Failed after ${executionTime}ms: ${errorMessage}`);

		// More detailed error analysis
		if (
			errorMessage.includes("forcibly terminated") ||
			errorMessage.includes("killed")
		) {
			console.log(`🔪 HARD TIMEOUT: Process was SIGKILL'd`);
			res.status(408).json({
				error: "Hard timeout",
				message: `Process was forcibly killed after ${executionTime}ms`,
				type: "sigkill_timeout",
				executionTime,
			});
		} else if (errorMessage.includes("timeout")) {
			console.log(`⏰ SOFT TIMEOUT: Internal synthase timeout fired`);
			res.status(408).json({
				error: "Script timeout",
				message: `Script execution timeout: ${errorMessage}`,
				type: "synthase_timeout",
				executionTime,
			});
		} else {
			console.log(`💥 OTHER ERROR: ${errorMessage}`);
			res.status(500).json({
				error: "Execution failed",
				message: errorMessage,
				type: "process_error",
				executionTime,
			});
		}
	}
});

export { router as synthaseRouter };
