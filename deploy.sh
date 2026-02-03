#!/bin/bash
if [ -z "$1" ]; then
  echo "Usage: ./deploy.sh \"commit message\""
  exit 1
fi

npm run build && git add -A && git commit -m "$1" && git push
