#!/bin/bash
PORT=${PORT:-3000}
curl -f http://localhost:${PORT}/health || exit 1
