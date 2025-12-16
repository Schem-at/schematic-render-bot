# Screenshot Debugging Guide

## Summary of Changes

### 1. Fixed Missing Event

- Added `onSchematicRendered` callback that fires `schematicRenderComplete` event
- Backend was waiting for this event before taking screenshots
- New renderer v1.1.14 has this callback but wasn't wired up

### 2. Added Stabilization

- 500ms delay after `onSchematicRendered` to ensure meshes are built
- Force render after delay to update canvas
- Comprehensive logging of scene state

### 3. Enhanced Screenshot Function

- Pre-screenshot state logging (scene children, mesh count, canvas size)
- 300ms stabilization period
- 3 render passes before capture
- Warning if screenshot blob is < 5KB (likely empty)

## Testing Steps

### 1. Restart Dev Server

```bash
# Stop current dev server (Ctrl+C)
bun run dev
```

You should now have hot reloading! Edit any frontend file and see instant updates.

### 2. Open Browser Console

Navigate to http://localhost:3000 and open DevTools console.

### 3. Load a Schematic

```javascript
// Wait for renderer to be ready
await window.schematicHelpers.waitForReady();

// Load a test schematic (you'll need actual schematic data)
// Example with base64 data:
await window.schematicHelpers.loadSchematic("test", yourBase64Data);

// Check what console logs - should see:
// 🎨 Schematic rendered: test
// 📊 Scene stats: { meshCount: X, totalChildren: Y, ... }
// 📡 Fired schematicRenderComplete event with X meshes
```

### 4. Take Screenshot

```javascript
const blob = await window.schematicHelpers.takeScreenshot();

// Check console output:
// 🔍 Pre-screenshot state: { sceneChildren: X, meshes: Y, ... }
// 📷 Calling recordingManager.takeScreenshot...
// ✅ Screenshot blob size: XXXXX bytes

// If you see a small blob size (< 5KB), screenshot is empty!

// View the screenshot:
const url = URL.createObjectURL(blob);
window.open(url);
```

### 5. Check Logging

**What to look for:**

```
✅ Good signs:
- "meshCount": > 0
- "sceneChildren": > 2 (should have lights + meshes)
- "Screenshot blob size": > 50000 bytes (50KB+)

❌ Bad signs:
- "meshCount": 0 (no geometry loaded!)
- "Screenshot blob size": < 5000 bytes (empty image)
- No "schematicRenderComplete" event fired
```

## Common Issues & Solutions

### Issue: "meshCount": 0

**Problem:** Schematic isn't loading or building meshes

**Debug:**

```javascript
// Check if schematic manager exists
console.log(window.schematicHelpers);

// Check scene
const scene = rendererRef?.current?.sceneManager?.scene;
console.log("Scene children:", scene?.children);
```

### Issue: Small Blob Size (< 5KB)

**Problem:** Canvas is empty when screenshot is taken

**Possible causes:**

1. **Timing**: Meshes not built yet when screenshot taken
2. **Canvas not rendered**: Need more render passes
3. **Canvas size wrong**: Check canvas dimensions

**Try:**

```javascript
// Take screenshot with delay
await new Promise((r) => setTimeout(r, 2000)); // Wait 2 seconds
const blob = await window.schematicHelpers.takeScreenshot();
```

### Issue: "schematicRenderComplete" Never Fires

**Problem:** New renderer's `onSchematicRendered` callback not working

**Debug:**

```javascript
// Listen for event manually
window.addEventListener("schematicRenderComplete", (e) => {
	console.log("Event fired!", e.detail);
});

// Then load schematic
await window.schematicHelpers.loadSchematic("test", data);
```

## API Testing

Test the render endpoint:

```bash
# Test with a real schematic file
curl -X POST http://localhost:3000/api/render \
  -F "schematic=@your-file.schem" \
  -o test-output.png

# Check the output
file test-output.png  # Should say "PNG image data"
ls -lh test-output.png  # Should be > 50KB
open test-output.png  # View it
```

## Next Steps If Still Empty

If screenshots are still empty after all this:

1. **Check if schematic data is valid**

   - Try loading the same schematic in the old renderer
   - Verify the file isn't corrupted

2. **Check renderer initialization**

   - Look for errors in console during init
   - Verify pack.zip loaded successfully

3. **Check canvas rendering**

   - Look at the visible canvas on screen
   - Is anything visible there?
   - If yes → screenshot timing issue
   - If no → rendering issue

4. **Compare old vs new renderer**

   - Check if there are breaking API changes
   - Look at new renderer's GitHub releases/changelog
   - Might need to update how we call `loadSchematic()`

5. **File an issue with the renderer**
   - If nothing works, this might be a bug in v1.1.14
   - Document steps to reproduce
   - Share console logs
