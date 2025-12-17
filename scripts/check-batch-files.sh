#!/bin/bash
# Script to check for batch download files on the server

echo "Checking for batch download files..."
echo "===================================="

# Check if batch storage directory exists
BATCH_DIR="/app/data/batch-downloads"

if [ -d "$BATCH_DIR" ]; then
    echo "Batch storage directory: $BATCH_DIR"
    echo ""
    
    # List all files with details
    if [ "$(ls -A $BATCH_DIR 2>/dev/null)" ]; then
        echo "Found batch files:"
        ls -lh "$BATCH_DIR" | tail -n +2 | awk '{print $9, "(" $5 ")"}'
        echo ""
        
        # Show total size
        TOTAL_SIZE=$(du -sh "$BATCH_DIR" | cut -f1)
        echo "Total size: $TOTAL_SIZE"
    else
        echo "No batch files found in storage directory."
    fi
else
    echo "Batch storage directory does not exist: $BATCH_DIR"
    echo "This might be the first time batch downloads are being used."
fi

echo ""
echo "===================================="
echo "Note: Files older than 24 hours are automatically cleaned up."
