#!/usr/bin/env bash
set -e
cd /home/pi/ScienceComp
# A clock jump mid-round ends the round early; the README says what to do when this is not yes.
echo "Clock synchronized: $(timedatectl show -p NTPSynchronized --value)"
git pull
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install
npm run build
sudo systemctl restart competition
sleep 3
systemctl is-active competition
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3001/api/health
echo Updated and restarted.
