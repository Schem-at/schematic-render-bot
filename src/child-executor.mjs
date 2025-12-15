// src/child-executor.mjs
import { execute } from 'synthase';
import nucleation, { SchematicWrapper } from 'nucleation';

// Initialize nucleation
await nucleation();

async function runScript() {
    try {
        const scriptContent = process.argv[2];
        const inputs = JSON.parse(process.argv[3]);
        const timeoutMs = parseInt(process.argv[4]) || 8000;

        console.log('🔧 Child: Starting execution...');
        console.log(`⏰ Child: Internal timeout set to ${timeoutMs}ms`);

        const startTime = Date.now();

        const result = await execute(
            scriptContent,
            inputs,
            {
                limits: { timeout: timeoutMs },
                contextProviders: { Schematic: SchematicWrapper },
            }
        );

        const endTime = Date.now();
        console.log(`✅ Child: Execution completed in ${endTime - startTime}ms`);

        // Send result back to parent with better IPC handling
        if (result.schematic && typeof result.schematic.to_schematic === 'function') {
            console.log(`📦 Child: Processing schematic result...`);
            const schematicBytes = result.schematic.to_schematic();
            const schematicBase64 = Buffer.from(schematicBytes).toString('base64');

            console.log(`📤 Child: Sending schematic result (${schematicBase64.length} chars)`);

            // Send message and wait for it to be received
            const message = {
                success: true,
                result: {
                    ...result,
                    schematic: schematicBase64,
                    hasSchematic: true
                }
            };

            // Check message size
            const messageSize = JSON.stringify(message).length;
            console.log(`📏 Child: Message size: ${messageSize} bytes`);

            if (messageSize > 100000) { // 100KB limit
                console.warn(`⚠️  Child: Large message detected, might cause IPC issues`);
            }

            process.send(message);

            // Wait a bit to ensure message transmission before exiting
            console.log(`⏳ Child: Waiting for message transmission...`);
            await new Promise(resolve => setTimeout(resolve, 100));

        } else {
            console.log(`📤 Child: Sending regular result`);
            process.send({ success: true, result });

            // Small delay for regular results too
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        console.log(`🏁 Child: Exiting process...`);
        process.exit(0);

    } catch (error) {
        const endTime = Date.now();
        console.error(`❌ Child error:`, error.message);
        console.error(`🔍 Child error type:`, error.name);

        process.send({
            success: false,
            error: {
                message: error.message,
                name: error.name || 'Error'
            }
        });

        // Wait before exiting on error too
        await new Promise(resolve => setTimeout(resolve, 50));
        process.exit(1);
    }
}

runScript().catch(error => {
    console.error('❌ Child fatal error:', error);
    process.exit(1);
});